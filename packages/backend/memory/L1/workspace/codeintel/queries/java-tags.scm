; Java tag queries
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

; === References ===

(method_invocation
  name: (identifier) @name.reference.call) @reference.call

(object_creation_expression
  type: (type_identifier) @name.reference.class) @reference.class

(superclass
  (type_identifier) @name.reference.class) @reference.class

(type_list
  (type_identifier) @name.reference.implementation) @reference.implementation
