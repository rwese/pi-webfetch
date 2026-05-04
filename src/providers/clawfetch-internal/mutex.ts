/**
 * Simple async mutex for preventing concurrent access
 */
export class ClawfetchMutex {
	private locked = false;
	private waitQueue: Array<() => void> = [];

	/**
	 * Acquire the lock. If already locked, waits until lock is released.
	 */
	async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true;
			return;
		}
		return new Promise<void>((resolve) => {
			this.waitQueue.push(resolve);
		});
	}

	/**
	 * Release the lock and process next waiting request
	 */
	release(): void {
		if (this.waitQueue.length > 0) {
			const next = this.waitQueue.shift();
			next!();
		} else {
			this.locked = false;
		}
	}
}
