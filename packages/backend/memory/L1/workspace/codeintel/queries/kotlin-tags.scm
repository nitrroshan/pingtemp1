; Kotlin tag queries

; Classes
(class_declaration
  (type_identifier) @name.definition.class) @definition.class

; Interfaces
(class_declaration
  (type_identifier) @name.definition.interface) @definition.interface

; Functions
(function_declaration
  (simple_identifier) @name.definition.function) @definition.function

; === References ===

(call_expression
  (simple_identifier) @name.reference.call) @reference.call

(call_expression
  (navigation_expression
    (simple_identifier) @name.reference.call)) @reference.call
