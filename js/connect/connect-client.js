// connect-client.js - Client for communicating with VRV Connect bridge service
// Sends public snapshot DTOs to Connect over HTTP.
// Does not access IndexedDB or VideoReviewer internals.

export const DEFAULT_CONNECT_URL = 'http://127.0.0.1:8765';

/**
 * Client for sending Core snapshots to VRV Connect.
 */
export class ConnectClient {
  /**
   * @param {string} [baseUrl] - Base URL for VRV Connect service (defaults to http://127.0.0.1:8765)
   * @param {object} [options]
   * @param {function} [options.fetchFn] - Custom fetch function for testing/injection
   */
  constructor(baseUrl = DEFAULT_CONNECT_URL, options = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!this.fetchFn) {
      throw new Error('Fetch API is not available in current environment.');
    }
  }

  /**
   * Sends a Core snapshot DTO to VRV Connect.
   * 
   * @param {object} snapshot - Valid Core Snapshot DTO
   * @returns {Promise<{ status: string, snapshotVersion: number, videoCount: number }>}
   * @throws {Error} for network failures, non-2xx status codes, or invalid responses
   */
  async sendSnapshot(snapshot) {
    if (!snapshot) {
      throw new Error('Snapshot payload is required.');
    }

    const endpoint = `${this.baseUrl}/api/v1/core/snapshot`;
    let response;

    try {
      response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(snapshot)
      });
    } catch (networkError) {
      throw new Error(`Connectに接続できません: ${networkError.message || networkError}`);
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errJson = await response.json();
        detail = errJson.detail || errJson.message || errJson.error || JSON.stringify(errJson);
      } catch (e) {
        detail = response.statusText || String(response.status);
      }
      throw new Error(`同期に失敗しました (${response.status}): ${detail}`);
    }

    try {
      const data = await response.json();
      return data;
    } catch (parseError) {
      throw new Error(`無効なレスポンス形式です: ${parseError.message}`);
    }
  }

  /**
   * Sends a private Media Locator projection DTO to VRV Connect.
   *
   * @param {object} locators - Valid Media Locator projection DTO
   * @returns {Promise<object>} Parsed Connect response
   * @throws {Error} for network failures, non-2xx status codes, or invalid responses
   */
  async sendMediaLocators(locators) {
    if (!locators) {
      throw new Error('Locator payload is required.');
    }

    const endpoint = `${this.baseUrl}/api/v1/core/media-locators`;
    let response;

    try {
      response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(locators)
      });
    } catch (networkError) {
      throw new Error(`Connectに接続できません: ${networkError.message || networkError}`);
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errJson = await response.json();
        detail = errJson.detail || errJson.message || errJson.error || JSON.stringify(errJson);
      } catch (e) {
        detail = response.statusText || String(response.status);
      }
      throw new Error(`メディアロケーター同期に失敗しました (${response.status}): ${detail}`);
    }

    try {
      const data = await response.json();
      return data;
    } catch (parseError) {
      throw new Error(`無効なレスポンス形式です: ${parseError.message}`);
    }
  }
}
