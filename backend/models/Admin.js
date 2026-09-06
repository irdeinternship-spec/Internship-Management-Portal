const bcrypt = require("bcryptjs");
const { createPostgresModel } = require("../services/mongoStore");

module.exports = createPostgresModel("admins.json", {}, {
  async beforeSave(admin) {
    if (admin.password && !admin.password.startsWith("$2")) {
      admin.password = await bcrypt.hash(admin.password, 12);
    }
    if (admin.secretAnswer && !admin.secretAnswer.startsWith("$2")) {
      admin.secretAnswer = await bcrypt.hash(admin.secretAnswer.trim().toLowerCase(), 12);
    }
  },
  async matchPassword(candidate) {
    return bcrypt.compare(candidate, this.password);
  },
  async matchSecretAnswer(candidate) {
    if (!this.secretAnswer) return false;
    return bcrypt.compare(candidate.trim().toLowerCase(), this.secretAnswer);
  },
});
