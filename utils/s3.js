const { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const path = require('path');

const bucketName = process.env.BUCKET_NAME
const bucketRegion = process.env.BUCKET_REGION
const accessKey = process.env.AWS_ACCESS_KEY
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY


const s3Client = new S3Client({
	region: bucketRegion,
	credentials: {
		accessKeyId: accessKey,
		secretAccessKey: secretAccessKey,
	}
});

// Set a custom file size limit (e.g., 3MB)
const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB in bytes

// Function to upload Image to S3
const uploadImage = async (file) => {
	const fieldName = file.fieldname; // get the field name we set in multer 
	const extension = path.extname(file.originalname); // Get file extension
	const filename = `${fieldName}/${Date.now()}_${path.basename(file.originalname, extension)}${extension}`; // Create a random file name to use on s3 in the avatar/bookImg dir
	try {

		// Check if the file exceeds the size limit
		if (file.size > MAX_FILE_SIZE) {
			throw new Error(`File size exceeds the limit of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
		}

		// Resize the image using sharp
		const buffer = await sharp(file.buffer)
			.resize({ height: 1920, width: 1080, fit: "contain" }) // Example: resize to 1920x1080 pixels
			.toBuffer()

		const params = {
			Bucket: bucketName,
			Key: filename,
			Body: buffer,
			ContentType: file.mimetype,
		};

		const command = new PutObjectCommand(params);

		await s3Client.send(command);

		return `https://${bucketName}.s3.${bucketRegion}.amazonaws.com/${params.Key}`;
	} catch (error) {
		console.error(`Error uploading ${fieldName}:`, error);
		throw new Error(`Failed to upload ${fieldName}: ${error.message}`);
	}
};

module.exports = { uploadImage };