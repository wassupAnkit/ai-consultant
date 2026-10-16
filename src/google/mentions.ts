/**
 * Does the consultant's message point at their own mailbox or Drive?
 *
 * The classifier's `needs_research` is tuned for the knowledge base: "draft a reply to her email"
 * reads as a draft built from supplied facts and skips research, which is also where the Gmail and
 * Drive tools live. When Google is connected, a message that names email or Drive material is
 * researched anyway, so the planner can read the thread or prepare the draft card. A false positive
 * costs one research round that answers "sufficient"; a false negative hides the consultant's mail.
 */
const WORKSPACE_TERMS =
  /\b(e-?mails?|mails?|inbox|gmail|mailbox|mail thread|email thread|threads?|drafts?\s+folder|my drafts|attachments?|google drive|my drive|drive folder|google docs?|google sheets?|shared drive|in (?:my|the) drive)\b/i;

/** "send hi to pranay@heubert.com", "write to priya@gmail.com …": a sending verb aimed at an address. */
const WRITE_TO_ADDRESS = /\b(send|write|draft|compose|reply|forward|email|mail)\b[^\n]{0,80}?[\w.+-]+@[\w-]+(\.[\w-]+)+/i;

/** The consultant's own schedule, or a request to produce a Doc or Sheet. */
const CALENDAR_AND_FILES =
  /\b(calendar|meetings?|appointments?|my schedule|schedule (?:a|an|the)|book (?:a|an|the)|free (?:time|slot)s?|availability|am i free|when am i free|busy (?:today|tomorrow|this week)|invite|(?:create|make|draft|put|write|start|build|prepare)\b[^\n]{0,40}\b(?:doc|document|sheet|spreadsheet|google doc|google sheet))\b/i;

export const mentionsWorkspace = (text: string): boolean => WORKSPACE_TERMS.test(text) || WRITE_TO_ADDRESS.test(text) || CALENDAR_AND_FILES.test(text);
