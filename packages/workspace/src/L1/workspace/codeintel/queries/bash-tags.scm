; Bash tag queries

; Functions
(function_definition
  name: (word) @name.definition.function) @definition.function

; === References ===

(command_name
  (word) @name.reference.call) @reference.call
