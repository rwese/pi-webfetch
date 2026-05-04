/**
 * File Type Detector
 *
 * Detects file types and provides utilities for file handling.
 */

/**
 * Get icon for file based on extension
 */
export function getFileIcon(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() || "";
	const icons: Record<string, string> = {
		// Code
		ts: "📜",
		tsx: "📜",
		js: "📜",
		jsx: "📜",
		py: "🐍",
		rb: "💎",
		go: "🔵",
		rs: "🦀",
		java: "☕",
		kt: "kotlin",
		swift: "🍎",
		c: "🔧",
		cpp: "🔧",
		h: "🔧",
		// Config
		json: "📋",
		yaml: "📋",
		yml: "📋",
		toml: "📋",
		// Markup
		md: "📝",
		html: "🌐",
		css: "🎨",
		scss: "🎨",
		// Images
		png: "🖼️",
		jpg: "🖼️",
		jpeg: "🖼️",
		gif: "🖼️",
		svg: "🖼️",
		// Docs
		txt: "📄",
		pdf: "📕",
		doc: "📘",
		// Archives
		zip: "📦",
		tar: "📦",
		gz: "📦",
		// Shell
		sh: "🐚",
		bash: "🐚",
		zsh: "🐚",
	};
	return icons[ext] || "📄";
}

/**
 * Check if file is an image
 */
export function isImageFile(filename: string): boolean {
	const ext = filename.split(".").pop()?.toLowerCase() || "";
	return ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext);
}

/**
 * Check if file is markdown
 */
export function isMarkdownFile(filename: string): boolean {
	const ext = filename.split(".").pop()?.toLowerCase() || "";
	return ["md", "mdx", "markdown"].includes(ext);
}

/**
 * Check if file is a code file
 */
export function isCodeFile(filename: string): boolean {
	const ext = filename.split(".").pop()?.toLowerCase() || "";
	return [
		"ts",
		"tsx",
		"js",
		"jsx",
		"py",
		"go",
		"rs",
		"java",
		"kt",
		"swift",
		"c",
		"cpp",
		"h",
		"hpp",
		"cs",
		"rb",
		"php",
		"lua",
		"sh",
		"bash",
		"zsh",
		"json",
		"yaml",
		"yml",
		"toml",
		"xml",
		"sql",
	].includes(ext);
}

/**
 * Check if file is text (non-code)
 */
export function isTextFile(filename: string): boolean {
	const ext = filename.split(".").pop()?.toLowerCase() || "";
	return ["txt", "log", "ini", "cfg", "conf", "env"].includes(ext);
}

/**
 * Get code language for syntax highlighting
 */
export function getCodeLanguage(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() || "";
	const langs: Record<string, string> = {
		ts: "typescript",
		tsx: "tsx",
		js: "javascript",
		jsx: "jsx",
		py: "python",
		go: "go",
		rs: "rust",
		java: "java",
		kt: "kotlin",
		swift: "swift",
		c: "c",
		cpp: "cpp",
		h: "c",
		hpp: "cpp",
		cs: "csharp",
		rb: "ruby",
		php: "php",
		lua: "lua",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		json: "json",
		yaml: "yaml",
		yml: "yaml",
		toml: "toml",
		xml: "xml",
		sql: "sql",
	};
	return langs[ext] || "text";
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	if (bytes < 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
