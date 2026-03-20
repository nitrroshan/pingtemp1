; Go tag queries
; Based on Aider's tree-sitter-language-pack

; Functions
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

; Methods
(method_declaration
  name: (field_identifier) @name.definition.method) @definition.method

; Types (struct, interface, type alias)
(type_declaration
  (type_spec
    name: (type_identifier) @name.definition.class
    type: (struct_type))) @definition.class

(type_declaration
  (type_spec
    name: (type_identifier) @name.definition.interface
    type: (interface_type))) @definition.interface

(type_spec
  name: (type_identifier) @name.definition.type) @definition.type

; Package
(package_clause
  (package_identifier) @name.definition.module) @definition.module

; Variables and constants
(var_declaration
  (var_spec
    name: (identifier) @name.definition.variable)) @definition.variable

(const_declaration
  (const_spec
    name: (identifier) @name.definition.constant)) @definition.constant

; === References ===

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (selector_expression
    field: (field_identifier) @name.reference.call)) @reference.call

(type_identifier) @name.reference.type @reference.type
