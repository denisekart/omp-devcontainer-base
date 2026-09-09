// lib/telegram.ts - Telegram Bot API client with long-poll loop and 429 handling
import { createWriteStream } from "node:fs";

export class ConflictError extends Error {}

export interface TelegramConfig {
  token: string;
  apiBase: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  forum_topic_created?: { name: string };
  reply_to_message?: TelegramMessage;
  thread_id?: number;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number | string;
  type: string;
  title?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from?: TelegramUser;
  message?: TelegramMessage;
  data: string;
  chat_instance: string;
}

export interface TelegramApiResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  error_parameters?: { retry_after?: number };
}

export interface TelegramCall {
  method: string;
  args?: Record<string, unknown>;
  response?: unknown;
  status?: number;
}

export interface TelegramApiCallbacks {
  onLog: (msg: string) => void;
  onLogError: (msg: string) => void;
  onReply: (call: TelegramCall, resp: TelegramApiResponse) => void;
  onUpdate: (update: TelegramUpdate) => void;
}

export class TelegramClient {
  private config: TelegramConfig;
  private callbacks: TelegramApiCallbacks;
  private offset = 0;
  private polling = false;
  private logStream: ReturnType<typeof createWriteStream> | null = null;

  constructor(config: TelegramConfig, callbacks: TelegramApiCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  setLogStream(stream: ReturnType<typeof createWriteStream> | null): void {
    this.logStream = stream;
  }

  private log(msg: string) {
    this.callbacks.onLog(msg);
    if (this.logStream) this.logStream.write(msg + "\n");
  }

  private logErr(msg: string) {
    this.callbacks.onLogError(msg);
    if (this.logStream) this.logStream.write(msg + "\n");
  }

  setOffset(offset: number): void {
    this.offset = offset;
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
  }

  async call(method: string, args?: Record<string, unknown>): Promise<TelegramApiResponse> {
    const url = `${this.config.apiBase}/v1/bot${this.config.token}/${method}`;
    const body = args ? JSON.stringify(args) : undefined;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = (await resp.json()) as TelegramApiResponse;
    const call: TelegramCall = { method, args, response: data, status: resp.status };
    this.callbacks.onReply(call, data);
    if (!data.ok) {
      // 409 = another daemon is polling the same token; fail fast so the
      // supervisor can exit instead of double-polling.
      if (data.error_code === 409) {
        throw new ConflictError(data.description ?? "409 conflict");
      }
      this.logErr(`API error ${method}: ${data.description} (code ${data.error_code})`);
      if (data.error_parameters?.retry_after) {
        this.log(`429 retry_after=${data.error_parameters.retry_after}, sleeping`);
        await this.delay(data.error_parameters.retry_after * 1000);
      }
    }
    return data;
  }

  async getMe(): Promise<TelegramUser | null> {
    const resp = await this.call("getMe");
    if (!resp.ok) return null;
    if (!resp.result) return null;
    return resp.result as TelegramUser;
  }

  async deleteWebhook(): Promise<boolean> {
    const resp = await this.call("deleteWebhook");
    return resp.ok;
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    options?: {
      parse_mode?: string;
      reply_markup?: unknown;
      message_thread_id?: number;
    },
  ): Promise<{ message_id: number } | null> {
    const args: Record<string, unknown> = { chat_id: chatId, text };
    if (options) Object.assign(args, options);
    const resp = await this.call("sendMessage", args);
    if (!resp.ok) return null;
    return resp.result as { message_id: number };
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: { parse_mode?: string; reply_markup?: unknown; message_thread_id?: number },
  ): Promise<boolean> {
    const args: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text,
    };
    if (options) Object.assign(args, options);
    const resp = await this.call("editMessageText", args);
    return resp.ok;
  }

  async createForumTopic(
    chatId: number | string,
    name: string,
  ): Promise<{ message_id: number } | null> {
    const resp = await this.call("createForumTopic", {
      chat_id: chatId,
      name,
    });
    if (!resp.ok) return null;
    return resp.result as { message_id: number };
  }

  async sendChatAction(chatId: number | string, action: string): Promise<boolean> {
    const resp = await this.call("sendChatAction", {
      chat_id: chatId,
      action,
    });
    return resp.ok;
  }

  async getUpdates(
    offset?: number,
    timeout?: number,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    const args: Record<string, unknown> = {};
    if (offset !== undefined) args.offset = offset;
    if (timeout !== undefined) args.timeout = timeout;
    if (limit !== undefined) args.limit = limit;
    const resp = await fetch(
      `${this.config.apiBase}/v1/bot${this.config.token}/getUpdates`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: args ? JSON.stringify(args) : undefined,
        signal,
      },
    );
    const data = (await resp.json()) as TelegramApiResponse;
    const call: TelegramCall = { method: "getUpdates", args, response: data, status: resp.status };
    this.callbacks.onReply(call, data);
    if (!resp.ok) {
      this.logErr(`getUpdates HTTP ${resp.status}: ${data.description}`);
      if (data.error_code === 409) throw new ConflictError(data.description ?? "409 conflict");
      return [];
    }
    if (!data.ok) {
      if (data.error_code === 409) {
        this.logErr("getUpdates 409 conflict: another instance is polling this token");
        throw new ConflictError(data.description ?? "409 conflict");
      }
      this.logErr(`getUpdates API error: ${data.description} (code ${data.error_code})`);
      return [];
    }
    return (data.result as TelegramUpdate[]) ?? [];
  }

  async getChat(chatId: number | string): Promise<TelegramChat | null> {
    const resp = await this.call("getChat", { chat_id: chatId });
    if (!resp.ok) return null;
    return resp.result as TelegramChat;
  }

  async startPolling(): Promise<void> {
    this.polling = true;
    while (this.polling) {
      try {
        const updates = await this.getUpdates(this.offset, 28);
        for (const update of updates) {
          this.offset = update.update_id + 1;
          this.callbacks.onUpdate(update);
        }
      } catch (err) {
        this.logErr(`Polling error: ${(err as Error).message}`);
        await this.delay(1000);
      }
    }
  }

  chunkText(text: string): string[] {
    const maxLen = 4096;
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxLen) {
      chunks.push(text.slice(i, i + maxLen));
    }
    return chunks;
  }

  stopPolling(): void {
    this.polling = false;
  }
}
