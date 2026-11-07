import type { LoggerService } from '@nestjs/common';
import { currentRequestId } from './request-context.js';
import { redact, scrubString, serializeError } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogSink = (line: string) => void;

/**
 * One JSON object per line on standard output, which is what Railway collects. Railway reads `message` and `level` as
 * the log's text and severity and turns every other top-level field into a filterable attribute (for example
 * `@requestId:<id>`), so the shape is flat. Everything goes to stdout: the severity is in `level`, so errors are not
 * mislabelled by the stream they were written to.
 *
 * Every field passes through redact(); a message passes through scrubString().
 */
export class JsonLogger implements LoggerService {
  private level: LogLevel = 'info';
  private sink: LogSink = (line) => {
    process.stdout.write(`${line}\n`);
  };
  private base: Record<string, unknown> = { service: 'nook-api' };

  configure(options: { level?: LogLevel; sink?: LogSink; base?: Record<string, unknown> }): void {
    if (options.level) this.level = options.level;
    if (options.sink) this.sink = options.sink;
    if (options.base) this.base = { ...this.base, ...options.base };
  }

  isEnabled(level: LogLevel): boolean {
    return RANK[level] >= RANK[this.level];
  }

  debug(message: string, fields?: Record<string, unknown>): void;
  debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }
  info(message: string, fields?: Record<string, unknown>): void;
  info(message: unknown, ...rest: unknown[]): void {
    this.emit('info', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }

  // ---- Nest's LoggerService (framework and startup messages)
  log(message: unknown, ...rest: unknown[]): void {
    this.emit('info', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }

  private emit(level: LogLevel, message: unknown, rest: unknown[]): void {
    if (!this.isEnabled(level)) return;
    const fields: Record<string, unknown> = {};
    let context: string | undefined;
    for (const item of rest) {
      if (item instanceof Error) fields.err = serializeError(item);
      else if (item && typeof item === 'object') Object.assign(fields, redact(item) as object);
      else if (typeof item === 'string' && item) {
        // Nest passes its context name (and, for errors, a stack) as trailing strings.
        if (item.includes('\n') && item.includes(' at '))
          fields.stack = redact(item.split('\n').slice(0, 15));
        else context = item;
      }
    }
    let text: string;
    if (message instanceof Error) {
      fields.err = serializeError(message);
      text = scrubString(message.message || message.name);
    } else if (typeof message === 'string') {
      text = scrubString(message);
    } else {
      text = scrubString(JSON.stringify(redact(message)) ?? String(message));
    }
    const requestId = currentRequestId();
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: text,
      ...this.base,
      ...(context ? { context } : {}),
      ...(requestId ? { requestId } : {}),
      ...fields,
    };
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({
        timestamp: entry.timestamp,
        level,
        message: text,
        service: 'nook-api',
      });
    }
    try {
      this.sink(line);
    } catch {
      // Logging must never break a request.
    }
  }
}

/** The process-wide logger (configured once at start-up by configureObservability). */
export const log = new JsonLogger();
