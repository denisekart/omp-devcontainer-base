// lib/render.ts — Live message editor: batching, chunking, rate limiting

import type { WriteStream } from "node:fs";
import type { TelegramClient } from "./telegram";

export interface LiveMessage {
  chatId: number | string;
  messageId: number;
  /** Ids of overflow messages (chunks beyond chunk[0]); edited in place on later flushes. */
  extraIds: number[];
  topicId: number;
  lines: string[];
  turnId: string;
  /** Last text that was successfully sent to Telegram; used to skip redundant edits. */
  lastSentText?: string;
}

export class RenderEngine {
  private liveMessages = new Map<string, LiveMessage>();
  private client: TelegramClient;
  private editIntervalMs: number;
  private logStream: WriteStream | null = null;
  private lastEditTime = 0;

  constructor(client: TelegramClient, editIntervalMs: number) {
    this.client = client;
    this.editIntervalMs = editIntervalMs;
  }

  setLogStream(stream: WriteStream) {
    this.logStream = stream;
  }

  private log(msg: string) {
    if (this.logStream) {
      this.logStream.write(`${msg}\n`);
    }
  }

  /**
   * Rendered messages use Telegram's HTML parse mode. Callers must supply
   * HTML-escaped text (the extension owns formatting); only `<pre>`, `<code>`,
   * `<b>` tags are produced, and splitHtmlAware keeps them balanced across
   * message boundaries.
   */
  async publishTurn(
    chatId: number | string,
    topicId: number,
    turnId: string,
    initialLine: string,
  ): Promise<number> {
    const key = `${chatId}:${topicId}:${turnId}`;
    const msg: LiveMessage = {
      chatId,
      messageId: 0,
      extraIds: [],
      topicId,
      lines: [initialLine],
      turnId,
    };
    this.liveMessages.set(key, msg);

    // Empty/framing-only turns: create the record so addLine has a handle,
    // but don't create a Telegram message until real content arrives.
    if (!initialLine.trim()) {
      return msg.messageId;
    }

    const chunks = this.client.splitHtmlAware(initialLine);
    for (let i = 0; i < chunks.length; i++) {
      const res = await this.client.sendMessage(chatId, chunks[i], {
        parse_mode: "HTML",
        message_thread_id: topicId,
      });
      if (res && typeof res === "object" && "message_id" in res) {
        if (i === 0) {
          msg.messageId = res.message_id;
        } else {
          msg.extraIds.push(res.message_id);
        }
      }
    }
    msg.lastSentText = msg.lines.join("\n");
    return msg.messageId;
  }

  async addLine(
    chatId: number | string,
    topicId: number,
    turnId: string,
    line: string,
  ): Promise<void> {
    const key = `${chatId}:${topicId}:${turnId}`;
    const msg = this.liveMessages.get(key);
    if (!msg) {
      // No live message for this turn (finalized, or lines racing the
      // turn_start frame) — render as its own message so the previous turn's
      // content is never edited into it.
      this.log(`No live message for ${key}, publishing new`);
      await this.publishTurn(chatId, topicId, turnId, line);
      return;
    }

    msg.lines.push(line);
    // Empty-line suppression: don't flush when accumulated text is whitespace-only.
    if (msg.lines.join("\n").trim() === "") return;

    const now = Date.now();
    const elapsed = now - this.lastEditTime;
    if (elapsed >= this.editIntervalMs) {
      this.lastEditTime = now;
      await this.flushMessage(msg);
    }
  }

  /**
   * Finalize a turn's live message: flush remaining lines and release the
   * handle so subsequent lines render as fresh messages instead of editing
   * this one.
   */
  async finalizeTurn(chatId: number | string, topicId: number, turnId: string): Promise<void> {
    const key = `${chatId}:${topicId}:${turnId}`;
    const msg = this.liveMessages.get(key);
    if (!msg) return;
    this.liveMessages.delete(key);
    await this.flushMessage(msg);
  }

  private async flushMessage(msg: LiveMessage): Promise<void> {
    const text = msg.lines.join("\n");
    if (!text.trim()) return;

    // Unchanged-text edit skip: if we've already sent this exact text,
    // skip editMessageText and all overflow edits to avoid 400 spam.
    if (msg.messageId > 0 && text === msg.lastSentText) {
      return;
    }

    const chunks = this.client.splitHtmlAware(text);
    const primary = chunks[0];
    const rest = chunks.slice(1);
    const sendOpts = { parse_mode: "HTML" as const, message_thread_id: msg.topicId };
    try {
      if (msg.messageId > 0) {
        const ok = await this.client.editMessageText(msg.chatId, msg.messageId, primary, sendOpts);
        if (!ok) {
          // Edit rejected (e.g. 400 unparseable entities) — the original
          // message keeps stale content, so deliver the full text fresh.
          for (const chunk of chunks) {
            await this.client.sendMessage(msg.chatId, chunk, sendOpts);
          }
          msg.extraIds = [];
          msg.lastSentText = text;
          return;
        }
        msg.lastSentText = text;
      } else {
        const res = await this.client.sendMessage(msg.chatId, primary, sendOpts);
        if (res) msg.messageId = res.message_id;
        msg.lastSentText = text;
      }
    } catch (err) {
      this.log(`Edit error: ${err}`);
      msg.lastSentText = text;
    }
    // Overflow chunks (chunk[1..]) are edited in place when we already have
    // their ids, otherwise sent as new messages; text only grows within a
    // turn, so the chunk count never shrinks.
    for (let i = 0; i < rest.length; i++) {
      try {
        const existing = msg.extraIds[i];
        if (typeof existing === "number" && existing > 0) {
          const ok = await this.client.editMessageText(msg.chatId, existing, rest[i], sendOpts);
          if (ok) continue;
        }
        const res = await this.client.sendMessage(msg.chatId, rest[i], sendOpts);
        msg.extraIds[i] = res ? res.message_id : 0;
      } catch (err) {
        this.log(`Edit error: ${err}`);
      }
    }
  }
}
