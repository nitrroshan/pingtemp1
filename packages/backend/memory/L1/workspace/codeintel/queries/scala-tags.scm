; Scala tag queries

; Classes
(class_definition
  name: (identifier) @name.definition.class) @definition.class

; Objects (singleton)
(object_definition
  name: (identifier) @name.definition.class) @definition.class

; Traits
(trait_definition
  name: (identifier) @name.definition.interface) @definition.interface

; Functions / methods
(function_definition
  name: (identifier) @name.definition.function) @definition.function

; Values
(val_definition
  pattern: (identifier) @name.definition.variable) @definition.variable

; === References ===

(call_expression
  function: (identifier) @name.reference.call) @reference.call
