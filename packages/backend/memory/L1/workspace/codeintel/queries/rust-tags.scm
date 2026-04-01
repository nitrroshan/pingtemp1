; Rust tag queries
; Based on Aider's tree-sitter-language-pack

; Structs, enums, unions, type aliases
(struct_item
  name: (type_identifier) @name.definition.class) @definition.class

(enum_item
  name: (type_identifier) @name.definition.class) @definition.class

(union_item
  name: (type_identifier) @name.definition.class) @definition.class

(type_item
  name: (type_identifier) @name.definition.type) @definition.type

; Methods (functions inside impl/trait blocks)
(declaration_list
  (function_item
    name: (identifier) @name.definition.method) @definition.method)

; Free functions
(function_item
  name: (identifier) @name.definition.function) @definition.function

; Traits
(trait_item
  name: (type_identifier) @name.definition.interface) @definition.interface

; Modules
(mod_item
  name: (identifier) @name.definition.module) @definition.module

; Macros
(macro_definition
  name: (identifier) @name.definition.macro) @definition.macro

; === References ===

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (field_expression
    field: (field_identifier) @name.reference.call)) @reference.call

(macro_invocation
  macro: (identifier) @name.reference.call) @reference.call

(impl_item
  trait: (type_identifier) @name.reference.implementation) @reference.implementation

(impl_item
  type: (type_identifier) @name.reference.implementation
  !trait) @reference.implementation
