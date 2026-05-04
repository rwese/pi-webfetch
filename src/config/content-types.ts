/**
 * Content Type Configuration
 *
 * Centralized configuration for content type detection and mapping.
 * Shared across all providers.
 */

/** Binary content types */
export const BINARY_CONTENT_TYPES = [
	"application/pdf",
	"application/zip",
	"application/gzip",
	"application/x-tar",
	"application/x-rar-compressed",
	"application/x-7z-compressed",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/bmp",
	"image/x-icon",
	"image/webp",
	"image/svg+xml",
	"audio/mpeg",
	"audio/mp3",
	"audio/wav",
	"video/mp4",
	"video/webm",
	"video/x-msvideo",
	"application/octet-stream",
] as const;

/** Type for binary content type strings */
export type BinaryContentType = (typeof BINARY_CONTENT_TYPES)[number];

/**
 * Check if a content type is binary
 */
export function isBinaryContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	const type = contentType.toLowerCase().split(";")[0].trim();
	return BINARY_CONTENT_TYPES.some(
		(binary) => type === binary || type.startsWith(binary.split("/")[0] + "/"),
	);
}

/** Mapping of content types to file extensions */
export const CONTENT_TYPE_TO_EXTENSION: Record<string, string> = {
	"application/pdf": "pdf",
	"application/zip": "zip",
	"application/gzip": "gz",
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/x-icon": "ico",
	"audio/mpeg": "mp3",
	"audio/mp3": "mp3",
	"audio/wav": "wav",
	"video/mp4": "mp4",
	"video/webm": "webm",
	"application/octet-stream": "bin",
};

/** Extension to content type mapping */
export const EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
	pdf: "application/pdf",
	zip: "application/zip",
	gz: "application/gzip",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	mp4: "video/mp4",
	webm: "video/webm",
};

/**
 * Get file extension from content type
 */
export function getExtensionFromContentType(
	contentType: string | null,
	url: string,
): string {
	if (!contentType) {
		return getExtensionFromUrl(url);
	}

	const type = contentType.toLowerCase().split(";")[0].trim();
	const mapped = CONTENT_TYPE_TO_EXTENSION[type];
	if (mapped) return mapped;

	// Try to extract from content-type header
	const match = type.match(/[a-z]+\/([a-z0-9]+)/i);
	if (match) {
		return match[1];
	}

	return getExtensionFromUrl(url);
}

/**
 * Get file extension from URL
 */
export function getExtensionFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const pathname = parsed.pathname;
		const lastSegment = pathname.split("/").pop() || "";
		const dotIndex = lastSegment.lastIndexOf(".");

		if (dotIndex > 0 && dotIndex < lastSegment.length - 1) {
			return lastSegment.substring(dotIndex + 1).toLowerCase();
		}
	} catch {
		// Invalid URL, continue
	}

	// Check for common file patterns in URL
	const pathLower = url.toLowerCase();
	if (pathLower.includes("png")) return "png";
	if (pathLower.includes("jpg") || pathLower.includes("jpeg")) return "jpg";
	if (pathLower.includes("gif")) return "gif";
	if (pathLower.includes("webp")) return "webp";
	if (pathLower.includes("pdf")) return "pdf";
	if (pathLower.includes("zip")) return "zip";

	return "bin";
}
