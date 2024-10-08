const router = require("express").Router()

router.use("/user", require("./userRoute"))
router.use("/admin", require("./adminRoute"))
router.use("/", require("./likeRoute"))
router.use("/", require("./bookmarkRoute"))
router.use("/", require("./commentRoute"))
router.use("/", require("./bookRoute"))

module.exports = router