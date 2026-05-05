/**
 * Google Drive API Service
 * Wraps Google Drive REST API calls for file management
 */

import { google } from "googleapis";
import type { drive_v3 } from "googleapis";

import { logger } from "./logger.js";
import type { GoogleAuth, DriveFile, DriveFileContent } from "./types.js";

export class GoogleDriveService {
  private drive: drive_v3.Drive;

  constructor(auth: GoogleAuth) {
    this.drive = google.drive({
      version: "v3",
      auth: auth as Parameters<typeof google.drive>[0]["auth"],
    });
  }

  /**
   * List recent files from Google Drive
   */
  async listFiles(
    maxResults: number = 10,
    mimeType?: string
  ): Promise<DriveFile[]> {
    try {
      logger.debug(`Listing Drive files (max: ${maxResults}, mimeType: ${mimeType || "all"})`);

      let query = "trashed = false";
      if (mimeType) {
        query += ` and mimeType = '${mimeType}'`;
      }

      const response = await this.drive.files.list({
        q: query,
        pageSize: maxResults,
        fields: "files(id, name, mimeType, modifiedTime, size, webViewLink, iconLink, owners)",
        orderBy: "modifiedTime desc",
      });

      const files = response.data.files || [];
      return files.map((file) => this.mapDriveFile(file));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list Drive files: ${message}`);
    }
  }

  /**
   * Search files by name or full-text content
   */
  async searchFiles(
    query: string,
    maxResults: number = 10,
    mimeType?: string
  ): Promise<DriveFile[]> {
    try {
      logger.debug(`Searching Drive files: ${query}`);

      // Escape single quotes in query
      const escapedQuery = query.replace(/'/g, "\\'");
      let searchQuery = `trashed = false and (name contains '${escapedQuery}' or fullText contains '${escapedQuery}')`;

      if (mimeType) {
        searchQuery += ` and mimeType = '${mimeType}'`;
      }

      const response = await this.drive.files.list({
        q: searchQuery,
        pageSize: maxResults,
        fields: "files(id, name, mimeType, modifiedTime, size, webViewLink, iconLink, owners)",
        orderBy: "modifiedTime desc",
      });

      const files = response.data.files || [];
      return files.map((file) => this.mapDriveFile(file));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to search Drive files: ${message}`);
    }
  }

  /**
   * Get file metadata
   */
  async getFile(fileId: string): Promise<DriveFile> {
    try {
      logger.debug(`Getting Drive file: ${fileId}`);

      const response = await this.drive.files.get({
        fileId,
        fields: "id, name, mimeType, modifiedTime, createdTime, size, webViewLink, iconLink, owners, description, starred",
      });

      return this.mapDriveFile(response.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get Drive file: ${message}`);
    }
  }

  /**
   * Download file content (for exportable Google Workspace files and binary files)
   */
  async downloadFile(fileId: string): Promise<DriveFileContent> {
    try {
      logger.debug(`Downloading Drive file: ${fileId}`);

      // First get file metadata to determine type
      const metadata = await this.drive.files.get({
        fileId,
        fields: "id, name, mimeType, size",
      });

      const mimeType = metadata.data.mimeType || "";
      const fileName = metadata.data.name || "unknown";

      // Google Workspace files need to be exported
      if (mimeType.startsWith("application/vnd.google-apps.")) {
        return this.exportGoogleFile(fileId, mimeType, fileName);
      }

      // Regular files can be downloaded directly
      const response = await this.drive.files.get(
        { fileId, alt: "media" },
        { responseType: "text" }
      );

      return {
        fileId,
        fileName,
        mimeType,
        content: typeof response.data === "string" ? response.data : JSON.stringify(response.data),
        exportedMimeType: mimeType,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to download Drive file: ${message}`);
    }
  }

  /**
   * Export Google Workspace files to standard formats
   */
  private async exportGoogleFile(
    fileId: string,
    mimeType: string,
    fileName: string
  ): Promise<DriveFileContent> {
    // Map Google mimeTypes to export formats
    const exportMimeTypes: Record<string, string> = {
      "application/vnd.google-apps.document": "text/plain",
      "application/vnd.google-apps.spreadsheet": "text/csv",
      "application/vnd.google-apps.presentation": "text/plain",
      "application/vnd.google-apps.drawing": "image/png",
    };

    const exportMimeType = exportMimeTypes[mimeType];
    if (!exportMimeType) {
      throw new Error(`Cannot export Google file type: ${mimeType}. Use the specific tool for this file type.`);
    }

    const response = await this.drive.files.export(
      { fileId, mimeType: exportMimeType },
      { responseType: "text" }
    );

    return {
      fileId,
      fileName,
      mimeType,
      content: typeof response.data === "string" ? response.data : JSON.stringify(response.data),
      exportedMimeType: exportMimeType,
    };
  }

  /**
   * Map Drive API response to DriveFile type
   */
  private mapDriveFile(file: drive_v3.Schema$File): DriveFile {
    return {
      id: file.id || "",
      name: file.name || "Untitled",
      mimeType: file.mimeType || "",
      modifiedTime: file.modifiedTime || "",
      createdTime: file.createdTime,
      size: file.size ? parseInt(file.size, 10) : undefined,
      webViewLink: file.webViewLink,
      iconLink: file.iconLink,
      owners: file.owners?.map((o) => o.displayName || o.emailAddress || "Unknown") || [],
      description: file.description,
      starred: file.starred,
    };
  }
}

/**
 * Get human-readable file type from mimeType
 */
export function getFileType(mimeType: string): string {
  const mimeTypeMap: Record<string, string> = {
    "application/vnd.google-apps.document": "Google Doc",
    "application/vnd.google-apps.spreadsheet": "Google Sheet",
    "application/vnd.google-apps.presentation": "Google Slides",
    "application/vnd.google-apps.folder": "Folder",
    "application/vnd.google-apps.form": "Google Form",
    "application/vnd.google-apps.drawing": "Google Drawing",
    "application/pdf": "PDF",
    "text/plain": "Text File",
    "text/csv": "CSV",
    "application/json": "JSON",
    "image/png": "PNG Image",
    "image/jpeg": "JPEG Image",
    "application/zip": "ZIP Archive",
  };

  return mimeTypeMap[mimeType] || mimeType.split("/").pop() || "File";
}

/**
 * Format file size to human-readable format
 */
export function formatFileSize(bytes?: number): string {
  if (!bytes) return "Unknown";

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
