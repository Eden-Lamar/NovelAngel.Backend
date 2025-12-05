import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.js";

passport.use(
	new GoogleStrategy(
		{
			clientID: process.env.GOOGLE_CLIENT_ID,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET,
			// 1. Logic to use the full HTTPS URL in production, relative in dev
			callbackURL: process.env.NODE_ENV === 'production'
				? `${process.env.API_URL}/api/v1/user/auth/google/callback`
				: "/api/v1/user/auth/google/callback",
			// 2. IMPORTANT: Trust the proxy so it knows it's HTTPS
			proxy: true,
		},
		async (accessToken, refreshToken, profile, done) => {
			try {
				const email = profile.emails?.[0]?.value;
				if (!email) return done(null, false, { message: "No email from Google" });

				let user = await User.findOne({ email });

				// If user doesn’t exist, create one (without password)
				if (!user) {
					user = await User.create({
						username: profile.displayName.replaceAll(" ", "_"),
						email,
						avatar: profile.photos?.[0]?.value,
						googleId: profile.id,
					});
				}
				// Passport passes this object into req.user
				done(null, user);
			} catch (err) {
				done(err, null);
			}
		}
	)
);

export default passport;
