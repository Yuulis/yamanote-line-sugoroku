import { useEffect, useState } from "react";

export interface ClearAnnouncement {
  /** Increases with every announcement so an update is never mistaken for the previous one. */
  readonly id: number;
  readonly text: string;
}

interface ClearAnnouncementsProps {
  /** The completion message published with the screen; empty when the result has none. */
  completion: string;
  /** Latest paging or share-result message. */
  message: ClearAnnouncement | null;
}

/**
 * The only live region of the clear screen. It mounts empty so that every text it later receives is announced
 * as a change; the visible copy of each message stays where the screen shows it, without live attributes.
 */
export function ClearAnnouncements({ completion, message }: ClearAnnouncementsProps) {
  const [text, setText] = useState("");
  useEffect(() => { if (completion !== "") setText(completion); }, [completion]);
  useEffect(() => { if (message) setText(message.text); }, [message]);
  return <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{text}</p>;
}
