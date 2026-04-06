; C++ tag queries — definitions only
; Based on Aider's tree-sitter-language-pack

(struct_specifier
  name: (type_identifier) @name.definition.class
  body: (_)) @definition.class

(declaration
  type: (union_specifier
    name: (type_identifier) @name.definition.class)) @definition.class

(class_specifier
  name: (type_identifier) @name.definition.class) @definition.class

(function_declarator
  declarator: (identifier) @name.definition.function) @definition.function

(function_declarator
  declarator: (field_identifier) @name.definition.function) @definition.function

(function_declarator
  declarator: (qualified_identifier
    name: (identifier) @name.definition.method)) @definition.method

(type_definition
  declarator: (type_identifier) @name.definition.type) @definition.type

(enum_specifier
  name: (type_identifier) @name.definition.type) @definition.type
