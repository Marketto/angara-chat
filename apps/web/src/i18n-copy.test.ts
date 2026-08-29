import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./i18n.ts', import.meta.url), 'utf8');

describe('product copy invariants', () => {
  it('does not describe the attachment-capable chat as text-only', () => {
    expect(source).not.toMatch(/SOLO TESTO|TEXT ONLY|ТОЛЬКО ТЕКСТ/);
  });

  it('accurately describes server storage and TLS-only transport protection in every locale', () => {
    expect(source).toContain("serverCiphertext: 'I messaggi sono conservati sul server. TLS li protegge durante il transito.'");
    expect(source).toContain("serverCiphertext: 'Messages are stored on the server. TLS protects them in transit.'");
    expect(source).toContain("serverCiphertext: 'Сообщения хранятся на сервере. TLS защищает их при передаче.'");
  });
});
