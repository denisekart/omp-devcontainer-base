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
  /** Forum topic id on messages in non-general topics (Telegram `Message.message_thread_id`). */
  message_thread_id?: number;
  /** Id of the topic-creation message (only on `forum_topic_created` updates). */
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
    const url = `${this.config.apiBase}/bot${this.config.token}/${method}`;
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

  async sendChatAction(chatId: number | string, action: string, opts?: { message_thread_id?: number }): Promise<boolean> {
    const callArgs: Record<string, unknown> = { chat_id: chatId, action };
    if (opts?.message_thread_id !== undefined) callArgs.message_thread_id = opts.message_thread_id;
    const resp = await this.call("sendChatAction", callArgs);
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
      `${this.config.apiBase}/bot${this.config.token}/getUpdates`,
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

  /**
   * Split HTML-formatted text into chunks of at most `maxLen` characters.
   * Unlike chunkText, tracks open `<pre>`/`<code>`/`<b>` tags: a chunk
   * boundary closes them, and the next chunk reopens them, so no chunk is
   * ever sent with unbalanced entities (Telegram rejects those with "can't
   * parse entities"). Prefers line boundaries; only hard-splits a single
   * line that exceeds the limit on its own.
   */
  splitHtmlAware(text: string, maxLen = 4096): string[] {
    if (text.length <= maxLen) return [text];
    const openStack: string[] = [];
    const chunks: string[] = [];
    const tagRe = /<\/?(?:pre|code|b)>/g;
    let buf = "";
    const flush = (): void => {
      if (!buf) return;
      let out = buf;
      for (let i = openStack.length - 1; i >= 0; i--) out += `</${openStack[i]}>`;
      chunks.push(out);
      let reopen = "";
      for (const t of openStack) reopen += `<${t}>`;
      buf = reopen;
    };
    for (const line of text.split("\n")) {
      // Safety net for a single line longer than the limit: hard-split it,
      // backing off from tag fragments so no "<" / ">" is cut in half.
      const units: string[] = [];
      let rest = line;
      while (rest.length > maxLen - 20) {
        let cut = maxLen - 20;
        if (rest[cut] === "<" || rest[cut] === ">") cut--;
        const lt = rest.lastIndexOf("<", cut - 1);
        if (lt !== -1 && cut - lt <= 8) cut = lt;
        units.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      if (rest) units.push(rest);
      for (const unit of units) {
        const stackLenBefore = openStack.reduce((n, t) => n + t.length + 3, 0);
        tagRe.lastIndex = 0;
        let tag: RegExpExecArray | null;
        while ((tag = tagRe.exec(unit))) {
          const name = tag[0].replace(/<\/?|>/g, "");
          if (tag[0].startsWith("</")) {
            if (openStack[openStack.length - 1] === name) openStack.pop();
          } else {
            openStack.push(name);
          }
        }
        // Reserve the worst-case closing cost so the chunk that ends this
        // segment still fits after the tags are closed at its boundary.
        const stackLenAfter = openStack.reduce((n, t) => n + t.length + 3, 0);
        const reserved = stackLenAfter > stackLenBefore ? stackLenAfter : stackLenBefore;
        if (buf && buf.length + unit.length + 1 + reserved > maxLen) flush();
        buf += (buf ? "\n" : "") + unit;
      }
    }
    flush();
    return chunks;
  }

  stopPolling(): void {
    this.polling = false;
  }
}
