import type { NextFunction, Request, Response } from "express";
import { fileTypeFromBuffer } from "file-type";
import multer from "multer";
import { allowedTypes, maxUploadBytes } from "../config/upload.js";
import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../errors/AppError.js";

export interface UploadedFileInfo {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  extension: string;
  size: number;
}

declare global {
  namespace Express {
    interface Request {
      uploadedFile?: UploadedFileInfo;
    }
  }
}

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 1 },
}).single("file");

export function uploadFile(req: Request, res: Response, next: NextFunction): void {
  multerUpload(req, res, async (error: unknown) => {
    try {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          throw new PayloadTooLargeError(
            `File exceeds the ${maxUploadBytes / 1024 / 1024} MB limit`,
          );
        }
        throw new ValidationError(`Upload error: ${error.message}`);
      }
      if (error) throw error;

      if (!req.file) {
        throw new ValidationError("A file is required (form field name: file)");
      }

      const detected = await fileTypeFromBuffer(req.file.buffer);
      const extension = detected ? allowedTypes[detected.mime] : undefined;

      if (!detected || !extension) {
        throw new UnsupportedMediaTypeError("Only PDF, DOCX, and XLSX files are allowed");
      }

      req.uploadedFile = {
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: detected.mime,
        extension,
        size: req.file.size,
      };
      next();
    } catch (err) {
      next(err);
    }
  });
}