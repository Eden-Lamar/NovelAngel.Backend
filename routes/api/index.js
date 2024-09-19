const router = require("express").Router()

router.use("/user", require("./userRoute"))
router.use("/admin", require("./adminRoute"))

module.exports = router