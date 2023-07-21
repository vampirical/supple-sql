'use strict';

class CallbackRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class FieldNotFoundError extends Error {
  constructor(fieldName, recordName) {
    super(`Cannot get field ${fieldName} on ${recordName}, does not exist.`);
    this.name = this.constructor.name;
  }
}

class ImplicitNestedTransactionError extends Error {
  constructor(message = 'Cannot run nested transaction() without allowNested specified.') {
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

class NoPoolSetError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class PrimaryKeyValueMissingError extends Error {
  constructor(recordName) {
    super(`Unable to set ${recordName} as loaded, one or more primary key fields are not set.`);
    this.name = this.constructor.name;
  }
}

class RecordMissingPrimaryKeyError extends Error {
  constructor(recordName) {
    super(recordName + ' must have primaryKeyFields.');
    this.name = this.constructor.name;
  }
}

class StatementTimeoutError extends Error {
  constructor() {
    super('Statement timeout.');
    this.name = this.constructor.name;
  }
}

module.exports = {
  CallbackRequiredError,
  FieldNotFoundError,
  ImplicitNestedTransactionError,
  IncorrectFieldsError,
  NoPoolSetError,
  PrimaryKeyValueMissingError,
  RecordMissingPrimaryKeyError,
  StatementTimeoutError,
};
