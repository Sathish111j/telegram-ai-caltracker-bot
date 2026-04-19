declare module 'xlsx' {
  export interface WorkSheet {
    [key: string]: unknown;
  }

  export interface WorkBook {
    Props?: Record<string, unknown>;
  }

  export const utils: {
    json_to_sheet(rows: Array<Record<string, unknown>>, options?: { header?: string[] }): WorkSheet;
    encode_range(range: { s: { r: number; c: number }; e: { r: number; c: number } }): string;
    book_new(): WorkBook;
    book_append_sheet(workbook: WorkBook, worksheet: WorkSheet, name: string): void;
  };

  export function write(
    workbook: WorkBook,
    options: { type: 'array'; bookType: string; compression?: boolean },
  ): ArrayBuffer;
}
