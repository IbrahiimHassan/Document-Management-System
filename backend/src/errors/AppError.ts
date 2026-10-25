export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input") {
    super(400, "VALIDATION_ERROR", message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "File is too large") {
    super(413, "FILE_TOO_LARGE", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "This conflicts with the current state") {
    super(409, "CONFLICT", message);
  }
}

export class VirusDetectedError extends AppError {
  constructor(message = "The file contains malware and was not saved") {
    super(422, "VIRUS_DETECTED", message);
  }
}

export class PreviewFailedError extends AppError {
  constructor(message = "This file can't be previewed. Download it to open it.") {
    super(422, "PREVIEW_FAILED", message);
  }
}

export class ScannerUnavailableError extends AppError {
  constructor(message = "The virus scanner is not available right now. Try again in a minute.") {
    super(503, "SCANNER_UNAVAILABLE", message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = "File type is not allowed") {
    super(415, "UNSUPPORTED_FILE_TYPE", message);
  }
}