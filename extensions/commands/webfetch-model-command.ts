import type { ExtensionAPI, ExtensionCommandContext, Theme } from '@earendil-works/pi-coding-agent';
import {
	Container,
	Input,
	type SelectItem,
	SelectList,
	type SelectListTheme,
	Spacer,
	Text,
	type TUI,
} from '@earendil-works/pi-tui';
import {
	getWebfetchConfigPath,
	loadWebfetchConfig,
	saveWebfetchConfig,
	type ResearchModelConfig,
} from '../model-config.js';

export const USE_PI_DEFAULT_MODEL = '__pi_webfetch_default_model__';

interface WebfetchModelCommandOptions {
	/** Config path override used by tests. */
	configPath?: string;
}

function canonicalModel(model: ResearchModelConfig): string {
	return `${model.provider}/${model.id}`;
}

/** Filter on every whitespace-delimited term across model spec and display name. */
export function filterModelItems(items: SelectItem[], query: string): SelectItem[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return items;
	return items.filter((item) => {
		const searchable = `${item.value} ${item.label} ${item.description ?? ''}`.toLowerCase();
		return terms.every((term) => searchable.includes(term));
	});
}

/** Register the scrollable `/webfetch:model` research-model selector. */
export function registerWebfetchModelCommand(
	pi: ExtensionAPI,
	options: WebfetchModelCommandOptions = {},
): void {
	pi.registerCommand('webfetch:model', {
		description: 'Select the research model used by the webfetch subagent',
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			const configPath = options.configPath ?? getWebfetchConfigPath();
			const current = loadWebfetchConfig(configPath).researchModel;
			const availableModels = ctx.modelRegistry.getAvailable();
			const modelsBySpec = new Map(
				availableModels.map((model) => [canonicalModel(model), model] as const),
			);

			const selected = await selectResearchModel(ctx, current, [...modelsBySpec.values()]);
			if (selected === null) return;

			try {
				if (selected === USE_PI_DEFAULT_MODEL) {
					saveWebfetchConfig({}, configPath);
					ctx.ui.notify('Research model reset to the Pi default.', 'info');
					return;
				}

				const model = modelsBySpec.get(selected);
				if (!model) {
					ctx.ui.notify(`Selected model is no longer available: ${selected}`, 'error');
					return;
				}
				saveWebfetchConfig(
					{ researchModel: { provider: model.provider, id: model.id } },
					configPath,
				);
				ctx.ui.notify(`Research model set to ${selected}.`, 'info');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to save webfetch model configuration: ${message}`, 'error');
			}
		},
	});
}

/** Show the same scrollable SelectList pattern used by pi-dynamic-workflows. */
export async function selectResearchModel(
	ctx: ExtensionCommandContext,
	current: ResearchModelConfig | undefined,
	availableModels: ResearchModelConfig[],
): Promise<string | null> {
	const currentSpec = current ? canonicalModel(current) : USE_PI_DEFAULT_MODEL;
	const items: SelectItem[] = [
		{
			value: USE_PI_DEFAULT_MODEL,
			label: 'Use Pi default model',
			description: "Clear the override and use Pi's normal model resolution",
		},
		...availableModels.map((model) => {
			const named = model as ResearchModelConfig & { name?: string };
			return {
				value: canonicalModel(model),
				label: canonicalModel(model),
				...(named.name ? { description: named.name } : {}),
			};
		}),
	];

	return ctx.ui.custom<string | null>((tui: TUI, theme: Theme, keybindings, done) => {
		const container = new Container();
		const currentLabel = current ? canonicalModel(current) : 'Pi default';
		container.addChild(
			new Text(
				theme.fg('accent', `Pick webfetch research model (current: ${currentLabel})`),
				1,
				0,
			),
		);
		container.addChild(new Spacer(1));

		const searchInput = new Input();
		searchInput.focused = true;
		container.addChild(new Text(theme.fg('dim', 'Search models:'), 1, 0));
		container.addChild(searchInput);
		container.addChild(new Spacer(1));

		const selectTheme: SelectListTheme = {
			selectedPrefix: (text) => theme.bg('selectedBg', theme.fg('accent', text)),
			selectedText: (text) => theme.bg('selectedBg', theme.bold(text)),
			description: (text) => theme.fg('muted', text),
			scrollInfo: (text) => theme.fg('dim', text),
			noMatch: () => theme.fg('warning', '  No matching models'),
		};
		const listContainer = new Container();
		container.addChild(listContainer);
		let selectList: SelectList;

		const rebuildList = (filteredItems: SelectItem[], preselectCurrent = false): void => {
			listContainer.clear();
			selectList = new SelectList(
				filteredItems,
				Math.max(1, Math.min(filteredItems.length, 12)),
				selectTheme,
			);
			if (preselectCurrent) {
				const currentIndex = filteredItems.findIndex((item) => item.value === currentSpec);
				if (currentIndex >= 0) selectList.setSelectedIndex(currentIndex);
			}
			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);
			listContainer.addChild(selectList);
		};
		rebuildList(items, true);

		container.addChild(new Spacer(1));
		container.addChild(
			new Text(
				theme.fg('dim', 'type to filter  ↑↓ navigate  enter select  esc cancel'),
				1,
				0,
			),
		);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				const isSelectionKey =
					keybindings.matches(data, 'tui.select.up') ||
					keybindings.matches(data, 'tui.select.down') ||
					keybindings.matches(data, 'tui.select.confirm') ||
					keybindings.matches(data, 'tui.select.cancel');
				if (isSelectionKey) {
					selectList.handleInput(data);
				} else {
					const previousQuery = searchInput.getValue();
					searchInput.handleInput(data);
					const query = searchInput.getValue();
					if (query !== previousQuery) rebuildList(filterModelItems(items, query));
				}
				tui.requestRender();
			},
		};
	});
}
