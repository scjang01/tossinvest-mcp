export const MAX_RATE_LIMIT_RETRIES = 2;
export const MAX_RATE_LIMIT_TOTAL_WAIT_MS = 30_000;

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfterMs(value: string | null): number {
  if (!value) {
    return 1_000;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }

  const retryDate = Date.parse(value);
  if (Number.isNaN(retryDate)) {
    return 1_000;
  }

  return Math.max(0, retryDate - Date.now());
}
