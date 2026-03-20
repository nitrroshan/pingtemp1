; Swift tag queries

; Classes
(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

; Structs
(struct_declaration
  name: (type_identifier) @name.definition.class) @definition.class

; Protocols
(protocol_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

; Enums
(enum_declaration
  name: (type_identifier) @name.definition.class) @definition.class

; Functions
(function_declaration
  name: (simple_identifier) @name.definition.function) @definition.function

; === References ===

(call_expression
  (simple_identifier) @name.reference.call) @reference.call
