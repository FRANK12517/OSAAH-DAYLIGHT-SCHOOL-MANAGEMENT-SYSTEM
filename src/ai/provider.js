export class AIProvider {
  async generate() { throw new Error('No AI provider is configured'); }
  async stream() { throw new Error('No AI provider is configured'); }
  async toolCall() { throw new Error('No AI provider is configured'); }
  async healthCheck() { return Object.freeze({ configured: false, healthy: false, reason: 'NO_PROVIDER_CONFIGURED' }); }
}
