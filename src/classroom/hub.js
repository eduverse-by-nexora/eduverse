// Lets the REST routes talk to the realtime classroom engine without a circular import.
module.exports = {
  engine: null,
  disconnectUser(userKey, reason) {
    if (this.engine) this.engine.disconnectUser(userKey, reason);
  },
};
