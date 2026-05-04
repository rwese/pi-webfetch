/**
 * Session Manager Service
 *
 * Manages session-scoped provider managers for browser state isolation.
 */

/**
 * Session-scoped provider managers
 * Each pi session gets its own provider manager with fresh browser state
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionProviders = new Map<symbol, any>();

/**
 * Get the provider manager for the current session
 * Creates a new one if not exists (session-scoped browser state)
 */
export async function getProviderManager(): Promise<any> {
	const key = Symbol('session');

	if (!sessionProviders.has(key)) {
		const module = await import('../../src/providers/manager.js');
		sessionProviders.set(key, new module.ProviderManager());
	}
	return sessionProviders.get(key);
}

/** Close all providers for a specific session */
export async function closeAllProviders(sessionId?: symbol): Promise<void> {
	const key = sessionId ?? Symbol('default');
	const manager = sessionProviders.get(key);
	if (manager) {
		await manager.closeAll();
		sessionProviders.delete(key);
	}
}

/** Close all providers across all sessions */
export async function closeAllSessionsProviders(): Promise<void> {
	await Promise.all(
		Array.from(sessionProviders.keys()).map((key) => closeAllProviders(key as symbol))
	);
}

/** Get status of all providers */
export async function getProviderStatus(): Promise<
	{ name: string; available: boolean; priority: number }[]
> {
	const manager = await getProviderManager();
	const providers = manager.getAll();
	const results = await Promise.all(
		providers.map(
			async (p: {
				name: string;
				priority: number;
				isAvailable: () => boolean | Promise<boolean>;
			}) => {
				const availableResult = p.isAvailable();
				const available =
					availableResult instanceof Promise ? await availableResult : availableResult;
				return {
					name: p.name,
					available,
					priority: p.priority,
				};
			},
		),
	);
	return results;
}
