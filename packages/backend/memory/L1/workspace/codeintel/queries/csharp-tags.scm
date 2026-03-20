; C# tag queries
; Based on Aider's tree-sitter-language-pack

; Classes
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

; Interfaces
(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

; Methods
(method_declaration
  name: (identifier) @name.definition.method) @definition.method

; Namespaces
(namespace_declaration
  name: (identifier) @name.definition.module) @definition.module

; === References ===

(class_declaration
  bases: (base_list
    (_) @name.reference.class)) @reference.class

(interface_declaration
  bases: (base_list
    (_) @name.reference.interface)) @reference.interface

(object_creation_expression
  type: (identifier) @name.reference.class) @reference.class

(invocation_expression
  function: (member_access_expression
    name: (identifier) @name.reference.call)) @reference.call

(variable_declaration
  type: (identifier) @name.reference.type) @reference.type
