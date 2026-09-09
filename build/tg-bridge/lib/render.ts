// lib/render.ts — Live message editor: batching, chunking, rate limiting

import { createWriteStream } from "node:fs";
import type { TelegramClient } from "./telegram";

export interface LiveMessage {
  chatId: number | string;
  messageId: number;
  topicId: number;
  lines: string[];
  turnId: string;
  finalized: boolean;
}

export class RenderEngine {
  private liveMessages = new Map<string, LiveMessage>();
  private client: TelegramClient;
  private editIntervalMs: number;
  private logStream: ReturnType<typeof createWriteStream> | null = null;
  private lastEditTime = 0;

  constructor(client: TelegramClient, editIntervalMs: number) {
    this.client = client;
    this.editIntervalMs = editIntervalMs;
  }

  setLogStream(stream: ReturnType<typeof createWriteStream>) {
    this.logStream = stream;
  }

  private log(msg: string) {
    if (this.logStream) {
      this.logStream.write(`${msg}\n`);
    }
  }

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
      topicId,
      lines: [initialLine],
      turnId,
      finalized: false,
    };
    this.liveMessages.set(key, msg);

    const fullText = initialLine;
    const chunks = this.client.chunkText(fullText);
    for (const chunk of chunks) {
      const res = await this.client.sendMessage(chatId, chunk, { message_thread_id: topicId });
      if (res && typeof res === "object" && "message_id" in res) {
        msg.messageId = res.message_id;
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


  private async flushMessage(msg: LiveMessage): Promise<void> {
    const text = msg.lines.join("\n");
    if (!text.trim()) return;

    const chunks = this.client.chunkText(text);
    for (const chunk of chunks) {
      try {
        if (msg.messageId > 0 && chunks.length === 1) {
          await this.client.editMessageText(msg.chatId, msg.messageId, chunk, {
            message_thread_id: msg.topicId,
          });
        } else {
          await this.client.sendMessage(msg.chatId, chunk, { message_thread_id: msg.topicId });
        }
      } catch (err) {
        this.log(`Edit error: ${err}`);
      }
    }
  }

}
