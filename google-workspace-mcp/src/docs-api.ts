/**
 * Google Docs API Service
 * Wraps Google Docs REST API calls
 */

import { google } from "googleapis";
import type { docs_v1 } from "googleapis";

import { logger } from "./logger.js";
import type { GoogleAuth, GoogleDoc, CreateDocParams, DocContent, TableRow } from "./types.js";

export class GoogleDocsService {
  private docs: docs_v1.Docs;
  private drive: ReturnType<typeof google.drive>;

  constructor(auth: GoogleAuth) {
    this.docs = google.docs({
      version: "v1",
      auth: auth as Parameters<typeof google.docs>[0]["auth"],
    });
    this.drive = google.drive({
      version: "v3",
      auth: auth as Parameters<typeof google.drive>[0]["auth"],
    });
  }

  /**
   * Get a document by ID
   */
  async getDocument(documentId: string): Promise<GoogleDoc> {
    try {
      logger.debug(`Getting document: ${documentId}`);
      const response = await this.docs.documents.get({
        documentId,
      });

      return response.data as GoogleDoc;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get document: ${message}`);
    }
  }

  /**
   * Create a new document
   */
  async createDocument(params: CreateDocParams): Promise<GoogleDoc> {
    try {
      logger.debug(`Creating document: ${params.title}`);

      // Create the document
      const response = await this.docs.documents.create({
        requestBody: {
          title: params.title,
        },
      });

      const documentId = response.data.documentId;

      // If content is provided, append it
      if (params.content && documentId) {
        await this.appendText(documentId, params.content);
      }

      logger.info(`Document created: ${documentId}`);
      return response.data as GoogleDoc;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create document: ${message}`);
    }
  }

  /**
   * Append text to a document
   */
  async appendText(documentId: string, text: string): Promise<void> {
    try {
      logger.debug(`Appending text to document: ${documentId}`);

      // Get the document to find the end index
      const doc = await this.getDocument(documentId);
      const endIndex = this.getDocumentEndIndex(doc);

      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: {
                  index: endIndex,
                },
                text: text,
              },
            },
          ],
        },
      });

      logger.info(`Text appended to document: ${documentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to append text: ${message}`);
    }
  }

  /**
   * Insert text at a specific index
   */
  async insertText(
    documentId: string,
    text: string,
    index: number
  ): Promise<void> {
    try {
      logger.debug(`Inserting text at index ${index} in document: ${documentId}`);

      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: {
                  index,
                },
                text,
              },
            },
          ],
        },
      });

      logger.info(`Text inserted in document: ${documentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to insert text: ${message}`);
    }
  }

  /**
   * Replace text in a document
   */
  async replaceText(
    documentId: string,
    searchText: string,
    replaceText: string,
    matchCase: boolean = false
  ): Promise<number> {
    try {
      logger.debug(`Replacing "${searchText}" with "${replaceText}" in document: ${documentId}`);

      const response = await this.docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              replaceAllText: {
                containsText: {
                  text: searchText,
                  matchCase,
                },
                replaceText,
              },
            },
          ],
        },
      });

      const occurrences =
        response.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
      logger.info(`Replaced ${occurrences} occurrences in document: ${documentId}`);
      return occurrences;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to replace text: ${message}`);
    }
  }

  /**
   * List recent documents from Google Drive
   */
  async listDocuments(maxResults: number = 10): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
    try {
      logger.debug(`Listing documents (max: ${maxResults})`);

      const response = await this.drive.files.list({
        q: "mimeType='application/vnd.google-apps.document'",
        pageSize: maxResults,
        fields: "files(id, name, modifiedTime)",
        orderBy: "modifiedTime desc",
      });

      const files = response.data.files || [];
      return files.map((file) => ({
        id: file.id || "",
        name: file.name || "Untitled",
        modifiedTime: file.modifiedTime || "",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list documents: ${message}`);
    }
  }

  /**
   * Search documents by name
   */
  async searchDocuments(
    query: string,
    maxResults: number = 10
  ): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
    try {
      logger.debug(`Searching documents: ${query}`);

      const response = await this.drive.files.list({
        q: `mimeType='application/vnd.google-apps.document' and name contains '${query.replace(/'/g, "\\'")}'`,
        pageSize: maxResults,
        fields: "files(id, name, modifiedTime)",
        orderBy: "modifiedTime desc",
      });

      const files = response.data.files || [];
      return files.map((file) => ({
        id: file.id || "",
        name: file.name || "Untitled",
        modifiedTime: file.modifiedTime || "",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to search documents: ${message}`);
    }
  }

  /**
   * Get document content as plain text
   */
  async getDocumentText(documentId: string): Promise<string> {
    try {
      const doc = await this.getDocument(documentId);
      return this.extractTextFromDoc(doc);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get document text: ${message}`);
    }
  }

  /**
   * Delete text from a document
   */
  async deleteText(
    documentId: string,
    startIndex: number,
    endIndex: number
  ): Promise<void> {
    try {
      logger.debug(`Deleting text from ${startIndex} to ${endIndex} in document: ${documentId}`);

      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              deleteContentRange: {
                range: {
                  startIndex,
                  endIndex,
                },
              },
            },
          ],
        },
      });

      logger.info(`Text deleted from document: ${documentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete text: ${message}`);
    }
  }

  /**
   * Helper: Get document end index
   */
  private getDocumentEndIndex(doc: GoogleDoc): number {
    if (!doc.body?.content) return 1;

    const lastElement = doc.body.content[doc.body.content.length - 1];
    // Subtract 1 because we insert before the final newline
    return (lastElement?.endIndex || 2) - 1;
  }

  /**
   * Helper: Extract plain text from document (includes tables as markdown)
   */
  private extractTextFromDoc(doc: GoogleDoc): string {
    if (!doc.body?.content) return "";

    let text = "";

    for (const element of doc.body.content) {
      if (element.paragraph?.elements) {
        for (const paragraphElement of element.paragraph.elements) {
          if (paragraphElement.textRun?.content) {
            text += paragraphElement.textRun.content;
          }
        }
      } else if (element.table) {
        text += this.extractTableAsMarkdown(element.table);
      }
    }

    return text;
  }

  /**
   * Helper: Extract table content as markdown table
   */
  private extractTableAsMarkdown(table: {
    rows?: number;
    columns?: number;
    tableRows?: TableRow[];
  }): string {
    if (!table.tableRows || table.tableRows.length === 0) return "";

    const rows: string[][] = [];

    for (const tableRow of table.tableRows) {
      const rowCells: string[] = [];
      if (tableRow.tableCells) {
        for (const cell of tableRow.tableCells) {
          const cellText = this.extractTextFromContent(cell.content || []);
          // Clean up cell text: trim and replace newlines with spaces
          rowCells.push(cellText.trim().replace(/\n/g, " "));
        }
      }
      rows.push(rowCells);
    }

    if (rows.length === 0) return "";

    // Build markdown table
    let markdown = "\n";

    // First row as header
    const headerRow = rows[0];
    markdown += "| " + headerRow.join(" | ") + " |\n";

    // Header separator
    markdown += "| " + headerRow.map(() => "---").join(" | ") + " |\n";

    // Data rows (skip first row since it's the header)
    for (let i = 1; i < rows.length; i++) {
      markdown += "| " + rows[i].join(" | ") + " |\n";
    }

    markdown += "\n";
    return markdown;
  }

  /**
   * Helper: Recursively extract text from DocContent array (used for table cells)
   */
  private extractTextFromContent(content: DocContent[]): string {
    let text = "";

    for (const element of content) {
      if (element.paragraph?.elements) {
        for (const paragraphElement of element.paragraph.elements) {
          if (paragraphElement.textRun?.content) {
            text += paragraphElement.textRun.content;
          }
        }
      } else if (element.table) {
        // Handle nested tables recursively
        text += this.extractTableAsMarkdown(element.table);
      }
    }

    return text;
  }
}

/**
 * Get document URL from ID
 */
export function getDocumentUrl(documentId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}
