import { randomUUID } from "node:crypto";
import {
  EVENT_SCHEMA_VERSION,
  MAX_EVENT_BYTES,
  encodedEventSize,
  parseJarvisEvent,
  type EventPayloadMap,
  type JarvisEvent,
  type KnownEventType,
  type KnownJarvisEvent,
} from "@jarvis/protocol";

export interface EventDelivery {
  durable: boolean;
}

export type EventListener = (
  event: KnownJarvisEvent,
  delivery: EventDelivery,
) => void | Promise<void>;

export interface EventBusOptions {
  initialSequence?: number;
  duplicateWindow?: number;
}

export class DuplicateEventError extends Error {
  override readonly name = "DuplicateEventError";
}

export class LocalEventBus {
  readonly #listeners = new Set<EventListener>();
  readonly #seenIds = new Set<string>();
  readonly #seenOrder: string[] = [];
  readonly #duplicateWindow: number;
  #sequence: number;

  constructor(options: EventBusOptions = {}) {
    this.#sequence = options.initialSequence ?? 0;
    this.#duplicateWindow = options.duplicateWindow ?? 10_000;
  }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  create<K extends KnownEventType>(
    type: K,
    source: string,
    payload: EventPayloadMap[K],
  ): KnownJarvisEvent {
    return parseJarvisEvent({
      id: randomUUID(),
      sequence: this.#sequence++,
      timestamp: new Date().toISOString(),
      type,
      source,
      schemaVersion: EVENT_SCHEMA_VERSION,
      payload,
    });
  }

  async publish(
    event: JarvisEvent,
    delivery: EventDelivery = { durable: true },
  ): Promise<void> {
    const validated = parseJarvisEvent(event);
    if (encodedEventSize(validated) > MAX_EVENT_BYTES)
      throw new RangeError("Event exceeds maximum encoded size");
    if (this.#seenIds.has(validated.id))
      throw new DuplicateEventError(`Duplicate event: ${validated.id}`);
    this.#seenIds.add(validated.id);
    this.#seenOrder.push(validated.id);
    if (this.#seenOrder.length > this.#duplicateWindow) {
      const expired = this.#seenOrder.shift();
      if (expired) this.#seenIds.delete(expired);
    }
    await Promise.all(
      [...this.#listeners].map(async (listener) =>
        listener(validated, delivery),
      ),
    );
  }
}
