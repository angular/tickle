/**
 * @externs
 * @suppress {duplicate}
 */
// NOTE: generated by tsickle, do not edit.
 /** @type {string} */
var exported;
 /** @type {string} */
var globalX;
/** @const */
var subnamespace = {};
 /** @type {string} */
subnamespace.Y;
/**
 * @externs
 * @suppress {duplicate}
 */
// NOTE: generated by tsickle, do not edit.
/** @const */
var DeclareTestModule = {};
/** @const */
DeclareTestModule.inner = {};
 /** @type {boolean} */
DeclareTestModule.inner.someBool;

/** @record @struct */
DeclareTestModule.Foo = function() {};
 /** @type {string} */
DeclareTestModule.Foo.prototype.field;

/**
 * @param {string} a
 * @return {number}
 */
DeclareTestModule.Foo.prototype.method = function(a) {};

/**
 * @constructor
 * @struct
 * @param {number} a
 */
DeclareTestModule.Clazz = function(a) {};

/**
 * Comment
 * @param {string} a
 * @return {number}
 */
DeclareTestModule.Clazz.prototype.method = function(a) {};

/** @record @struct */
DeclareTestModule.NotYetHandled = function() {};

/* TODO: IndexSignature: DeclareTestModule */

/** @const */
DeclareTestModule.Enumeration = {};
/** @const {number} */
DeclareTestModule.Enumeration.Value1;
/** @const {number} */
DeclareTestModule.Enumeration.Value3;

/** @const */
DeclareTestModule.StringEnum = {};
/** @const {number} */
DeclareTestModule.StringEnum.foo;

/* TODO: StringLiteral: '.tricky.invalid name' */

/** @typedef {(string|number)} */
DeclareTestModule.TypeAlias;
/** @const */
var tsickle_declare_module = {};
// Derived from: declare module "DeclareTest-QuotedModule"
/** @const */
tsickle_declare_module.DeclareTest_QuotedModule = {};
 /** @type {string} */
tsickle_declare_module.DeclareTest_QuotedModule.foo;
 /** @type {number} */
var declareGlobalVar;

/**
 * @param {string} x
 * @return {number}
 */
function declareGlobalFunction(x) {}

/** @record @struct */
function DeclareTestInterface() {}
 /** @type {string} */
DeclareTestInterface.prototype.foo;

/**
 * @constructor
 * @struct
 * @param {number=} a
 */
function MultipleConstructors(a) {}

/**
 * @return {?}
 */
Object.prototype.myMethod = function() {};

/**
 * @param {string|number} x_or_y
 * @param {string=} x
 * @return {!CodeMirror.Editor}
 */
function CodeMirror(x_or_y, x) {}

/** @record @struct */
CodeMirror.Editor = function() {};
 /** @type {string} */
CodeMirror.Editor.prototype.name;

/**
 * @param {string|number} url_or_status
 * @param {string|number=} url_or_status1
 * @return {void}
 */
function redirect(url_or_status, url_or_status1) {}

/**
 * @param {number} a
 * @param {...?|string} b
 * @return {string}
 */
function TestOverload(a, b) {}

/** @record @struct */
function BareInterface() {}
 /** @type {string} */
BareInterface.prototype.name;

/**
 * @param {string} tsickle_arguments
 * @return {?}
 */
function usesArguments(tsickle_arguments) {}

/**
 * @param {?} __0
 * @return {?}
 */
function destructures(__0) {}

/** @const */
var ChartType = {};
/** @const {number} */
ChartType.line;
/** @const {number} */
ChartType.bar;
