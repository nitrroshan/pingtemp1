; TypeScript tag queries — definitions and references
; Based on Aider's tree-sitter-language-pack (MIT/Apache-2.0)

; Functions
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(function_signature
  name: (identifier) @name.definition.function) @definition.function

; Methods
(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(method_signature
  name: (property_identifier) @name.definition.method) @definition.method

(abstract_method_signature
  name: (property_identifier) @name.definition.method) @definition.method

; Classes
(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(abstract_class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

; Interfaces
(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

; Types
(type_alias_declaration
  name: (type_identifier) @name.definition.type) @definition.type

; Enums
(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

; Modules / Namespaces
(module
  name: (identifier) @name.definition.module) @definition.module

; Arrow functions / function expressions assigned to variables
(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

; === References ===

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference.call)) @reference.call

(new_expression
  constructor: (identifier) @name.reference.class) @reference.class

(type_annotation
  (type_identifier) @name.reference.type) @reference.type
