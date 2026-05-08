const { DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface) => {
    // Create Users Table
    await queryInterface.createTable('users', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    });

    // Create Notes Table
    await queryInterface.createTable('notes', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      full_text: {
        type: DataTypes.TSVECTOR,
      },
    });

    // Create Index for Full-Text Search
    await queryInterface.sequelize.query(`CREATE INDEX idx_notes_fulltext ON notes USING GIN (full_text)`);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('notes');
    await queryInterface.dropTable('users');
  },
};