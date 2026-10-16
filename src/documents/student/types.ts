/**
 * Wire and storage types for student document intake (docs/document-intake/contract.md). The
 * frontend mirrors AttachmentView and DocumentExtractionView; change all of them together.
 */

/** Stream event carrying one DocumentExtractionView, before any crm_write_proposal of the turn. */
export const DOCUMENT_EXTRACTION_EVENT = "document_extraction";

export const STUDENT_DOC_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export type StudentDocMimeType = (typeof STUDENT_DOC_MIME_TYPES)[number];

export interface AttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Hex sha256 of the original (plaintext) bytes. */
  sha256: string;
  createdAt: string;
}

export type FieldConfidence = "high" | "medium" | "low";

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  confidence: FieldConfidence;
  source: "mrz" | "visual";
}

export const WARNING_CODES = [
  "mrz_checksum_failed",
  "expired",
  "expires_within_12_months",
  "name_mismatch_crm",
  "dob_mismatch_crm",
  "unreadable",
  "not_identity_document",
  "no_student_selected",
  "aadhaar_masked",
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

export interface DocumentWarning {
  code: WarningCode;
  message: string;
}

export type DocumentType = "passport" | "national_id" | "other";

export interface DocumentExtractionView {
  attachmentId: string;
  fileName: string;
  documentType: DocumentType;
  /** The CRM checklist name the file is filed under: "Passport", "Citizenship/National ID", or null for other. */
  crmDocumentType: string | null;
  /** Issuing country, English name. */
  country: string | null;
  holderName: string | null;
  fields: ExtractedField[];
  warnings: DocumentWarning[];
}

/** One extraction run, kept on the stored document forever (history is never deleted). */
export interface ExtractionRun {
  at: Date;
  requestId: string | null;
  sessionId: string | null;
  model: string;
  documentType: DocumentType;
  /** Finer kind, e.g. "nepal_citizenship", "india_aadhaar". */
  idKind: string;
  country: string | null;
  holderName: string | null;
  fields: ExtractedField[];
  warnings: DocumentWarning[];
  ms: number;
}

/** A proposal made from this document, and each later status it reached. Append-only. */
export interface DocumentCrmAction {
  proposalId: string;
  tool: string;
  status: string;
  at: Date;
  /** Fields the counsellor edited before approving. */
  edited?: { field: string; from: unknown; to: unknown }[];
}

/** One stored upload. The bytes live encrypted in the `student_files` bucket under `_id`. */
export interface StudentDocumentRecord {
  _id: string;
  ownerId: string;
  sessionId: string | null;
  /** The CRM contact the document was read for, once known. */
  contactId: string | null;
  fileName: string;
  mimeType: StudentDocMimeType;
  sizeBytes: number;
  sha256: string;
  /** How the stored bytes are encrypted (AES-256-GCM, iv prepended to the ciphertext). */
  enc: { v: 1; alg: "AES-256-GCM"; kid: string };
  createdAt: Date;
  extractions: ExtractionRun[];
  crmActions: DocumentCrmAction[];
}

export const toAttachmentView = (r: Pick<StudentDocumentRecord, "_id" | "fileName" | "mimeType" | "sizeBytes" | "sha256" | "createdAt">): AttachmentView => ({
  id: r._id,
  fileName: r.fileName,
  mimeType: r.mimeType,
  sizeBytes: r.sizeBytes,
  sha256: r.sha256,
  createdAt: r.createdAt.toISOString(),
});

/** CRM checklist names (the `checklists` table) a document is filed under. */
export const CRM_DOCUMENT_TYPES: Record<Exclude<DocumentType, "other">, { name: string; category: string }> = {
  passport: { name: "Passport", category: "Personal" },
  national_id: { name: "Citizenship/National ID", category: "Personal" },
};
