const Joi = require("joi");

const registerValidation = (data) => {
	const schema = Joi.object({
		username: Joi.string().min(3).required(),
		email: Joi.string().min(6).required().email(),
		password: Joi.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d!@#$%^&*()_+\-=[\]{};:'"\\|,.<>/?]{8,}$/).messages({
			'string.pattern.base': 'Password must Contain at least 8 Characters, One Uppercase, One Lowercase, and One Number'
		}).required(),
		role: Joi.string()
	});

	return schema.validate(data)
}


const loginValidation = (data) => {
	const schema = Joi.object({
		email: Joi.string().min(6).required().email(),
		password: Joi.string().min(8).required(),
	});

	return schema.validate(data)

}


module.exports = {
	registerValidation,
	loginValidation,
};
