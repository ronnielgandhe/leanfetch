import { deepReadCost } from '@/lib/ui/adapter';

export async function startScan(config, onEvent) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
      const e = new Error(err.error || `Server error: ${response.status}`);
      e.status = response.status;
      e.code = err.code;
      throw e;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.trim()) {
          try {
            onEvent(JSON.parse(line));
          } catch {}
        }
      }
    }

    // flush remaining buffer
    if (buffer.trim()) {
      try {
        onEvent(JSON.parse(buffer));
      } catch {}
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export function calculateCost(tokenUsage, deepReadModel) {
  const triage = 0;
  const deepScan = deepReadCost(tokenUsage.deepScan, deepReadModel || 'claude-sonnet-5-5');
  const synthesis = 0;
  return { triage, deepScan, synthesis, total: triage + deepScan + synthesis };
}
