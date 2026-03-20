; Python tag queries
; Based on Aider's tree-sitter-language-pack

; Top-level constants
(module
  (expression_statement
    (assignment
      left: (identifier) @name.definition.constant))) @definition.constant

; Classes
(class_definition
  name: (identifier) @name.definition.class) @definition.class

; Functions / methods
(function_definition
  name: (identifier) @name.definition.function) @definition.function

; === References ===

(call
  function: (identifier) @name.reference.call) @reference.call

(call
  function: (attribute
    attribute: (identifier) @name.reference.call)) @reference.call
