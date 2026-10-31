import type { AppConfig } from '../config.ts';

export type DispatchOutcome = 'acknowledged' | 'rejected' | 'uncertain';

export function dispatchConfigured(config: AppConfig): boolean {
  return (
    config.githubRepository !== '' &&
    config.githubWorkflowId !== '' &&
    config.githubRef !== '' &&
    config.githubToken !== ''
  );
}

export async function dispatchWorkflow(
  config: AppConfig,
  runId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DispatchOutcome> {
  const url = `https://api.github.com/repos/${config.githubRepository}/actions/workflows/${encodeURIComponent(config.githubWorkflowId)}/dispatches`;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.githubToken}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'supermarket-api',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ ref: config.githubRef, inputs: { runId } }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? 'acknowledged' : 'rejected';
  } catch {
    return 'uncertain';
  }
}
