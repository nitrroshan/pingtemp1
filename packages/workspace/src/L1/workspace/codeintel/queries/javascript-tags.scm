; JavaScript tag queries — definitions and references
; Based on Aider's tree-sitter-language-pack

; Methods
(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

; Classes
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

; Functions
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(function_expression
  name: (identifier) @name.definition.function) @definition.function

(generator_function_declaration
  name: (identifier) @name.definition.function) @definition.function

; Arrow functions / function expressions assigned to variables
(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

; Assignment to function
(assignment_expression
  left: (identifier) @name.definition.function
  right: [(arrow_function) (function_expression)]) @definition.function

(assignment_expression
  left: (member_expression
    property: (property_identifier) @name.definition.function)
  right: [(arrow_function) (function_expression)]) @definition.function

; Object method shorthand
(pair
  key: (property_identifier) @name.definition.function
  value: [(arrow_function) (function_expression)]) @definition.function

; === References ===

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference.call)) @reference.call

(new_expression
  constructor: (identifier) @name.reference.class) @reference.class
