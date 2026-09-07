// lib/render.ts — Live message editor: batching, chunking, rate limiting

import { createWriteStream } from "node:fs";
import type { TelegramClient } from "./telegram";

export interface RenderCallbacks {
  onLine: (topicId: number, line: string) => void;
  onFinalize: (topicId: number, summary: string) => void;
}

export interface LiveMessage {
  chatId: number | string;
  messageId: number;
  lines: string[];
  turnId: string;
  finalized: boolean;
}

export class RenderEngine {
  private liveMessages = new Map<string, LiveMessage>();
  private callbacks: RenderCallbacks;
  private client: TelegramClient;
  private editIntervalMs: number;
  private logStream: ReturnType<typeof createWriteStream> | null = null;
  private lastEditTime = 0;

  constructor(client: TelegramClient, callbacks: RenderCallbacks, editIntervalMs: number) {
    this.client = client;
    this.callbacks = callbacks;
    this.editIntervalMs = editIntervalMs;
  }

  setLogStream(stream: ReturnType<typeof createWriteStream>) {
    this.logStream = stream;
  }

  private log(msg: string) {
    if (this.logStream) {
      this.logStream.write(msg + "\n");
    }
  }

  startTurn(
    chatId: number | string,
    topicId: number,
    turnId: string,
  ): number | null {
    const key = `${chatId}:${topicId}:${turnId}`;
    if (this.liveMessages.has(key)) {
      this.log(`Turn already active: ${key}`);
      return null;
    }
    const msg = {
      chatId,
      messageId: 0,
      lines: [],
      turnId,
      finalized: false,
    };
    this.liveMessages.set(key, msg);
    return null;
  }

  async publishTurn(
    chatId: number | string,
    topicId: number,
    turnId: string,
    initialLine: string,
  ): Promise<number> {
    const key = `${chatId}:${topicId}:${turnId}`;
    const msg = {
      chatId,
      messageId: 0,
      lines: [initialLine],
      turnId,
      finalized: false,
    };
    this.liveMessages.set(key, msg);

    const fullText = initialLine;
    const chunks = this.client.chunkText(fullText);
    for (const chunk of chunks) {
      const res = await this.client.sendMessage(chatId, chunk);
      if (res && typeof res === "object" && "message_id" in res) {
        msg.messageId = (res as { message_id: number }).message_id;
      }
    }
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
      this.log(`No live message for ${key}, publishing new`);
      await this.publishTurn(chatId, topicId, turnId, line);
      return;
    }

    msg.lines.push(line);
    const now = Date.now();
    const elapsed = now - this.lastEditTime;
    if (elapsed >= this.editIntervalMs) {
      this.lastEditTime = now;
      await this.flushMessage(msg);
    }
  }

  async finalizeTurn(
    chatId: number | string,
    topicId: number,
    turnId: string,
    summary: string,
  ): Promise<void> {
    const key = `${chatId}:${topicId}:${turnId}`;
    const msg = this.liveMessages.get(key);
    if (!msg) return;

    msg.finalized = true;
    msg.lines.push(summary);
    this.lastEditTime = 0; // Force flush
    await this.flushMessage(msg);
    this.callbacks.onFinalize(topicId, summary);
    this.liveMessages.delete(key);
  }

  private async flushMessage(msg: LiveMessage): Promise<void> {
    const text = msg.lines.join("\n");
    if (!text.trim()) return;

    const chunks = this.client.chunkText(text);
    for (const chunk of chunks) {
      try {
        if (msg.messageId > 0 && chunks.length === 1) {
          await this.client.editMessageText(msg.chatId, msg.messageId, chunk);
        } else {
          await this.client.sendMessage(msg.chatId, chunk);
        }
      } catch (err) {
        this.log(`Edit error: ${err}`);
      }
    }
  }

  clearChat(chatId: number | string): void {
    for (const [key, msg] of this.liveMessages) {
      if (msg.chatId === chatId) {
        this.liveMessages.delete(key);
      }
    }
  }

  getActiveTurns(): string[] {
    return Array.from(this.liveMessages.keys());
  }
}
