; Lua tag queries

; Functions
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(function_declaration
  name: (dot_index_expression
    field: (identifier) @name.definition.function)) @definition.function

; Local functions
(variable_declaration
  (assignment_statement
    (variable_list
      name: (identifier) @name.definition.function)
    (expression_list
      value: (function_definition)))) @definition.function

; === References ===

(function_call
  name: (identifier) @name.reference.call) @reference.call

(function_call
  name: (dot_index_expression
    field: (identifier) @name.reference.call)) @reference.call
