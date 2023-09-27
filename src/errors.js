'use strict';

class AsyncIterationUnavailableError extends Error {
  constructor(message = 'Set the stream option to enable async iteration') {
    super(message);
    this.name = this.constructor.name;
  }
}

class FieldNotFoundError extends Error {
  constructor(fieldName, recordName) {
    super(`Field ${fieldName} does not exist on ${recordName}.`);
    this.name = this.constructor.name;
  }
}

class ImplicitNestedTransactionError extends Error {
  constructor(message = 'Cannot run nested transaction() without allowNested specified.') {
    super(message);
    this.name = this.constructor.name;
  }
}

class IncompatibleOutputSpecifiedError extends Error {
  constructor(message = 'Incompatible output specified') {
    super(message);
    this.name = this.constructor.name;
  }
}

class IncorrectFieldsError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class InvalidOutputTypeError extends Error {
  constructor(type) {
    super(`Invalid output type: ${type}`);
    this.name = this.constructor.name;
  }
}

class NoPoolSetError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class PrimaryKeyValueMissingError extends Error {
  constructor(recordName) {
    super(`Unable to treat ${recordName} as loaded, one or more primary key fields are not set.`);
    this.name = this.constructor.name;
  }
}

class QueryNotLoadedIterationError extends Error {
  constructor(message = 'Query is not synchronously iterable unless isLoaded=true.') {
    super(message);
    this.name = this.constructor.name;
  }
}

class RecordMissingPrimaryKeyError extends Error {
  constructor(recordName) {
    super(recordName + ' must have primaryKeyFields.');
    this.name = this.constructor.name;
  }
}

class RecordTypeRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class StatementTimeoutError extends Error {
  constructor() {
    super('Statement timeout.');
    this.name = this.constructor.name;
  }
}

class UnavailableInStreamModeError extends Error {
  constructor(message = 'Unavailable in stream mode') {
    super(message);
    this.name = this.constructor.name;
  }
}

class AutoPrunedUnusablePoolConnectionError extends Error {
  constructor(message = 'Auto pruned pool unusable connection') {
    super(message);
    this.name = this.constructor.name;
  }
}

class FailedToFindUsablePoolConnectionError extends Error {
  constructor(message = 'Failed to find a usable pool connection.') {
    super(message);
    this.name = this.constructor.name;
  }
}

class MissingRequiredArgError extends Error {
  constructor() {
    super('Missing required argument.');
    this.name = this.constructor.name;
  }
}

class InvalidOptionCombinationError extends Error {
  constructor(message = 'Invalid option combination.') {
    super(message);
    this.name = this.constructor.name;
  }
}

module.exports = {
  AutoPrunedUnusablePoolConnectionError,
  AsyncIterationUnavailableError,
  FailedToFindUsablePoolConnectionError,
  FieldNotFoundError,
  ImplicitNestedTransactionError,
  IncompatibleOutputSpecifiedError,
  IncorrectFieldsError,
  InvalidOptionCombinationError,
  InvalidOutputTypeError,
  MissingRequiredArgError,
  NoPoolSetError,
  PrimaryKeyValueMissingError,
  RecordMissingPrimaryKeyError,
  RecordTypeRequiredError,
  QueryNotLoadedIterationError,
  StatementTimeoutError,
  UnavailableInStreamModeError,
};
