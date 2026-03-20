; PHP tag queries

; Classes
(class_declaration
  name: (name) @name.definition.class) @definition.class

; Interfaces
(interface_declaration
  name: (name) @name.definition.interface) @definition.interface

; Functions
(function_definition
  name: (name) @name.definition.function) @definition.function

; Methods
(method_declaration
  name: (name) @name.definition.method) @definition.method

; === References ===

(function_call_expression
  function: (name) @name.reference.call) @reference.call

(function_call_expression
  function: (member_access_expression
    name: (name) @name.reference.call)) @reference.call

(object_creation_expression
  (name) @name.reference.class) @reference.class
