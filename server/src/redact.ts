// Strips secrets from anything that might get logged or returned to a client: last_error
// columns, 502 error bodies. Never perfect (best-effort regex scrub), but covers the shapes
// tokens/URLs actually take in this codebase.
export function redact(input: string): string {
  let out = input;
  out = out.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  out = out.replace(/access_token=[^&\s"']+/gi, 'access_token=[redacted]');
  out = out.replace(/refresh_token=[^&\s"']+/gi, 'refresh_token=[redacted]');
  out = out.replace(/"?password"?\s*[:=]\s*"?[^"&\s,}]+/gi, 'password=[redacted]');
  // URL userinfo + query string
  out = out.replace(/(https?:\/\/)([^/\s@]+@)/gi, '$1[redacted]@');
  out = out.replace(/(https?:\/\/[^\s?#"']+)\?[^\s#"']*/gi, '$1?[redacted]');
  return out;
}

export function errorMessage(err: unknown, fallback = 'unexpected error'): string {
  return redact(err instanceof Error ? err.message : fallback);
}
