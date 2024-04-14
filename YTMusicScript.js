const PLATFORM_CLAIMTYPE = 12;

var langDisplayRegion = "en-US";
var langDisplay = "en";
var langRegion = "US";

const URL_BASE = "https://www.youtube.com";
const URL_CONTEXT = "https://www.youtube.com";

const URL_PLAYER = "https://youtubei.googleapis.com/youtubei/v1/player";

const USER_AGENT_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36";
const USER_AGENT_PHONE = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.5481.153 Mobile Safari/537.36";
const USER_AGENT_TABLET = "Mozilla/5.0 (iPad; CPU OS 13_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/87.0.4280.77 Mobile/15E148 Safari/604.1";
const USER_AGENT_IOS = "com.google.ios.youtube/17.31.4(iPhone14,5; U; CPU iOS 15_6 like Mac OS X; US)";
const USER_AGENT_ANDROID = "com.google.android.youtube/17.31.35 (Linux; U; Android 12; US) gzip";
const USER_AGENT_TVHTML5_EMBED = "Mozilla/5.0 (CrKey armv7l 1.5.16041) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/31.0.1650.0 Safari/537.36";

const REGEX_YTCFG = new RegExp(/ytcfg\.set\((.*?)\);/g);

const REGEX_VIDEO_URL_DESKTOP = new RegExp("https://(.*\\.)?youtube\\.com/watch.*?v=(.*)");
const REGEX_VIDEO_URL_SHARE = new RegExp("https://youtu\\.be/(.*)");
const REGEX_VIDEO_URL_SHARE_LIVE = new RegExp("https://(.*\\.)?youtube\\.com/live/(.*)");
const REGEX_VIDEO_URL_SHORT = new RegExp("https://(.*\\.)?youtube\\.com/shorts/(.*)");
const REGEX_VIDEO_URL_CLIP = new RegExp("https://(.*\\.)?youtube\\.com/clip/(.*)[?]?");
const REGEX_VIDEO_URL_EMBED = new RegExp("https://(.*\\.)?youtube\\.com/embed/([^?]+)");

const REGEX_INITIAL_DATA = new RegExp("<script.*?var ytInitialData = (.*?);<\/script>");
const REGEX_INITIAL_PLAYER_DATA = new RegExp("<script.*?var ytInitialPlayerResponse = (.*?});");

const REGEX_CIPHERS = [
	new RegExp("(?:\\b|[^a-zA-Z0-9$])([a-zA-Z0-9$]{2,})\\s*=\\s*function\\(\\s*a\\s*\\)\\s*\\{\\s*a\\s*=\\s*a\\.split\\(\\s*\"\"\\s*\\)"),
	new RegExp("\\bm=([a-zA-Z0-9$]{2,})\\(decodeURIComponent\\(h\\.s\\)\\)"),
	new RegExp("\\bc&&\\(c=([a-zA-Z0-9$]{2,})\\(decodeURIComponent\\(c\\)\\)"),
	new RegExp("([\\w$]+)\\s*=\\s*function\\((\\w+)\\)\\{\\s*\\2=\\s*\\2\\.split\\(\"\"\\)\\s*;"),
	new RegExp("\\b([\\w$]{2,})\\s*=\\s*function\\((\\w+)\\)\\{\\s*\\2=\\s*\\2\\.split\\(\"\"\\)\\s*;"),
	new RegExp("\\bc\\s*&&\\s*d\\.set\\([^,]+\\s*,\\s*(:encodeURIComponent\\s*\\()([a-zA-Z0-9$]+)\\(")
];

var config = {};
var _settings = {};
var _clientContext = {};

source.enable = function(conf, settings, savedState){
	config = conf ?? {};
    const isLoggedIn = false;//bridge.isLoggedIn();
    let batchReq = http.batch()
        .GET(URL_CONTEXT, {"Accept-Language": "en-US" }, false);
    if(isLoggedIn)
        batchReq = batchReq.GET(URL_CONTEXT_M, { "User-Agent": USER_AGENT_TABLET, "Accept-Language": "en-US" }, true);
    const batchResp = batchReq.execute();
		console.log("batchResp", batchResp);
		throwIfCaptcha(batchResp[0])
		if (!batchResp[0].isOk)
			throw new ScriptException("Failed to request context enable !batchResp[0].isOk");
    _clientContext = getClientConfig(batchResp[0].body)
}

source.setSettings = function(settings) {
	_settings = settings;
}

source.getContentDetails = (url, useAuth) => {
	useAuth = !!_settings?.authDetails || !!useAuth;

    url = convertIfOtherUrl(url);

	const clientContext = getClientContext(false);

	const videoId = extractVideoIDFromUrl(url);
	if(IS_TESTING)
		console.log("VideoID:", videoId);

	const useLogin = useAuth && bridge.isLoggedIn();

	const headersUsed = (useLogin) ? getAuthContextHeaders(false) : {};
	headersUsed["Accept-Language"] = "en-US";
	headersUsed["Cookie"] = "PREF=hl=en&gl=US"

	const batch = http.batch().GET(url, headersUsed, useLogin);
		
	if(videoId && _settings["youtubeDislikes"])
		batch.GET(URL_YOUTUBE_DISLIKES + videoId, {}, false);
	const resps = batch.execute();

    throwIfCaptcha(resps[0]);
	if(!resps[0].isOk)
		throw new ScriptException("Failed to request page [" + resps[0].code + "]");

	const html = resps[0].body;//requestPage(url);
	const initialData = getInitialData(html);
	let initialPlayerData = getInitialPlayerData(html);

    if(initialPlayerData?.playabilityStatus?.status == "UNPLAYABLE")
		throw new UnavailableException("Video unplayable");
	
	const jsUrlMatch = html.match("PLAYER_JS_URL\"\\s?:\\s?\"(.*?)\"");
	const jsUrl = (jsUrlMatch) ? jsUrlMatch[1] : clientContext.PLAYER_JS_URL;
	const isNewCipher = prepareCipher(jsUrl);
	
	const ageRestricted = initialPlayerData.playabilityStatus?.reason?.indexOf("your age") > 0 ?? false;
	if (ageRestricted) {
		if (_settings["allowAgeRestricted"]) {
			const sts = _sts[jsUrl];
			if (!initialPlayerData.streamingData && sts) {
				initialPlayerData = requestTvHtml5EmbedStreamingData(initialPlayerData.videoDetails.videoId, sts);
				console.log("Filled missing streaming data using TvHtml5Embed.");
			}
		} else {
			throw new AgeException("Age restricted videos can be allowed using the plugin settings");
		}
	}
	const controversial = initialPlayerData.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText?.indexOf("following content may") > 0 ?? false;
	if(controversial) {
		if (_settings["allowControversialRestricted"]) {
			const sts = _sts[jsUrl];
			if (!initialPlayerData.streamingData && sts) {
				initialPlayerData = requestTvHtml5EmbedStreamingData(initialPlayerData.videoDetails.videoId, sts);
				console.log("Filled missing streaming data using TvHtml5Embed.");
			}
		} else {
			throw new UnavailableException("Controversial restricted videos can be allowed using the plugin settings");
		}
	}
	
	if (initialPlayerData.playabilityStatus?.status == "LOGIN_REQUIRED") {
		throw new ScriptException("Login required\nReason: " + initialPlayerData?.playabilityStatus?.reason);
	}
		
	if(IS_TESTING) {
		console.log("Initial Data", initialData);
		console.log("Initial Player Data", initialPlayerData);
	}

	const videoDetails = extractVideoPage_VideoDetails(initialData, initialPlayerData, {
		url: url
	}, jsUrl);
	if(videoDetails == null)
	    throw new UnavailableException("No video found");

	if(!videoDetails.live && 
		(videoDetails.video?.videoSources == null || videoDetails.video.videoSources.length == 0) &&
		(!videoDetails.datetime || videoDetails.datetime < (((new Date()).getTime() / 1000) - 60 * 60))) {
        if(isNewCipher) {
            log("Unavailable video found with new cipher, clearing cipher");
            clearCipher(jsUrl);
        }
		throw new UnavailableException("No sources found");
    }

	//Substitute Dash manifest from Android
	if(USE_ANDROID_FALLBACK && videoDetails.dash && videoDetails.dash.url) {
		const androidData = requestAndroidStreamingData(videoDetails.id.value);
		if(IS_TESTING)
			console.log("Android Streaming Data", androidData);
		if(androidData?.streamingData?.dashManifestUrl) {
			log("Using Android dash substitute");
			const existingUrl = videoDetails.dash.url;
			videoDetails.dash.url = androidData.streamingData.dashManifestUrl;
			if(existingUrl == videoDetails.live?.url)
				videoDetails.live.url = androidData.streamingData.dashManifestUrl;
		}
	}
	//Substitute HLS manifest from iOS
	if(USE_IOS_FALLBACK && videoDetails.hls && videoDetails.hls.url) {
		const iosData = requestIOSStreamingData(videoDetails.id.value);
		if(IS_TESTING)
			console.log("IOS Streaming Data", iosData);
		if(iosData?.streamingData?.hlsManifestUrl) {
			log("Using iOS HLS substitute");
			const existingUrl = videoDetails.hls.url;
			videoDetails.hls.url = iosData.streamingData.hlsManifestUrl;
			if(existingUrl == videoDetails.live?.url)
				videoDetails.live.url = iosData.streamingData.hlsManifestUrl;
		}
	}

	if(resps.length > 1) {
		try {
            const youtubeDislikeInfoResponse = resps[1]
            if(youtubeDislikeInfoResponse.isOk) {
                const youtubeDislikeInfo = JSON.parse(youtubeDislikeInfoResponse.body);
                if(IS_TESTING)
                    console.log("Youtube Dislike Info", youtubeDislikeInfo);
                videoDetails.rating = new RatingLikesDislikes(videoDetails.rating.likes, youtubeDislikeInfo.dislikes);
            }
        }
        catch(ex) {
            console.log("Failed to fetch Youtube Dislikes", ex);
        }
	}

	const finalResult = videoDetails;
	finalResult.__initialData = initialData;
	if(!!_settings["youtubeActivity"] && useLogin) {
		finalResult.__playerData = initialPlayerData;
		finalResult.getPlaybackTracker = function(url) {
			return source.getPlaybackTracker(url, initialPlayerData)
		};
	}
	finalResult.getContentChapters = function() {
		return source.getContentChapters(url, finalResult.__initialData);
	};

	return finalResult;
};


function convertIfOtherUrl(url) {
    url = convertIfShortUrl(url);
    url = convertIfEmbedUrl(url);
    return url;
}
function convertIfEmbedUrl(url) {
    const embedMatch = url.match(REGEX_VIDEO_URL_EMBED);
    if(embedMatch && embedMatch.length == 3) {
        let id = embedMatch[2];
        if(id.indexOf("?") > 0)
            id = id.substring(0, id.indexOf("?"));
        url = URL_BASE + "/watch?v=" + id;
    }
    return url;
}
function convertIfShortUrl(url) {
    const shortMatch = url.match(REGEX_VIDEO_URL_SHORT);
    if(shortMatch && shortMatch.length == 3) {
        let id = shortMatch[2];
        if(id.indexOf("?") > 0)
            id = id.substring(0, id.indexOf("?"));
        url = URL_BASE + "/watch?v=" + id;
    }
    return url;
}

function getClientContext(isAuth = false) {
	return (isAuth) ? _clientContextAuth : _clientContext;
}

function throwIfCaptcha(resp) {
    if (resp != null && resp.code === 429 && resp.body != null && resp.body.includes("captcha")) {
        throw new CaptchaRequiredException(resp.url, resp.body);
    }
    return true;
}

function getClientConfig(html) {
	const matches = html.matchAll(REGEX_YTCFG);
	let match = null;
	for(let m of matches) {
		if(m && m.length >= 2 && m[1].indexOf("INNERTUBE_CONTEXT") > 0) {
			match = m;
		}
	}

	if(!match) throw new ScriptException("Context structure not found");
	return JSON.parse(match[1]);
}

function removeQuery(urlPart) {
	if(!urlPart)
		return urlPart;
	if(urlPart.indexOf("?") > 0)
		return urlPart.substring(0, urlPart.indexOf("?"));
	else if(urlPart.indexOf("&") > 0)
		return urlPart.substring(0, urlPart.indexOf("&"));
	return urlPart;
}

function extractVideoIDFromUrl(url) {
	let match = url.match(REGEX_VIDEO_URL_DESKTOP);
	if(match)
		return removeQuery(match[2]);

	match = url.match(REGEX_VIDEO_URL_SHARE);
	if(match)
		return removeQuery(match[1]);

	match = url.match(REGEX_VIDEO_URL_SHARE_LIVE);
	if(match)
		return removeQuery(match[2]);

	match = url.match(REGEX_VIDEO_URL_SHORT);
	if(match)
		return removeQuery(match[2]);

	return null;
}

source.getHome = function(continuationToken) {
    /**
     * @param continuationToken: any?
     * @returns: VideoPager
     */
    return source.getContentDetails('https://www.youtube.com/watch?v=OhENgnE2oow', false);
    const videos = []; // The results (PlatformVideo)
    const hasMore = false; // Are there more pages?
    const context = { continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeHomeVideoPager(videos, hasMore, context);
}

function getInitialPlayerData(html) {
	const match = html.match(REGEX_INITIAL_PLAYER_DATA);
	if(match) {
		const initialDataRaw = match[1];
		return JSON.parse(initialDataRaw);
	}
	return null;
}

function getInitialData(html, useAuth = false) {
	const clientContext = getClientContext(useAuth);

	//TODO: Fix regex instead of this temporary workaround.
	/*
	const startIndex = html.indexOf("var ytInitialData = ");
	const endIndex = html.indexOf(";</script>", startIndex);
	if(startIndex > 0 && endIndex > 0) {
	    const raw = html.substring(startIndex + 20, endIndex);
	    const initialDataRaw = raw.startsWith("'") && raw.endsWith("'") ?
            decodeHexEncodedString(raw.substring(1, raw.length - 1))
                //TODO: Find proper decoding strat
                .replaceAll("\\\\\"", "\\\"") :
            raw;
		let initialData = null;
		try{
			initialData = JSON.parse(initialDataRaw);
		}
		catch(ex) {
			console.log("Failed to parse initial data: ", initialDataRaw);
			throw ex;
		}
		if(clientContext?.INNERTUBE_CONTEXT && !clientContext.INNERTUBE_CONTEXT.client.visitorData &&
			initialData.responseContext?.webResponseContextExtensionData?.ytConfigData?.visitorData) {
				clientContext.INNERTUBE_CONTEXT.client.visitorData = initialData.responseContext?.webResponseContextExtensionData?.ytConfigData?.visitorData
			log("Found new visitor (auth) data: " + clientContext.INNERTUBE_CONTEXT.client.visitorData);
		}
		return initialData;
	}*/

	const match = html.match(REGEX_INITIAL_DATA);
	if(match) {
		const initialDataRaw = match[1].startsWith("'") && match[1].endsWith("'") ?
			decodeHexEncodedString(match[1].substring(1, match[1].length - 1))
				//TODO: Find proper decoding strat
				.replaceAll("\\\\\"", "\\\"") : 
			match[1];
		let initialData = null;
		try{
			initialData = JSON.parse(initialDataRaw);
		}
		catch(ex) {
			console.log("Failed to parse initial data: ", initialDataRaw);
			throw ex;
		}
		
		
		if(clientContext?.INNERTUBE_CONTEXT && !clientContext.INNERTUBE_CONTEXT.client.visitorData &&
			initialData.responseContext?.webResponseContextExtensionData?.ytConfigData?.visitorData) {
				clientContext.INNERTUBE_CONTEXT.client.visitorData = initialData.responseContext?.webResponseContextExtensionData?.ytConfigData?.visitorData
			log("Found new visitor (auth) data: " + clientContext.INNERTUBE_CONTEXT.client.visitorData);
		}
		return initialData;
	}
	//if(initialData == null)
	//    log(html);

	return null;
}

var _cipherDecode = {

};

var _nDecrypt = {
	
};

function clearCipher(jsUrl) {
    if(_cipherDecode[jsUrl])
        _cipherDecode[jsUrl] = undefined;
    if(_nDecrypt[jsUrl])
        _nDecrypt[jsUrl] = undefined;
}

function prepareCipher(jsUrl) {
	if(_cipherDecode[jsUrl])
		return false;//_cipherDecode[jsUrl];
	log("New JS Url found: [" + jsUrl + "], fetching new js (total: " + (Object.keys(_cipherDecode).length + 1) + ")");

	//try{
    if (true) {
		const playerCodeResp = http.GET(URL_BASE + jsUrl, {});
		if(!playerCodeResp.isOk)
			throw new ScriptException("Failed to get player js");
		console.log("Javascript Url: " + URL_BASE + jsUrl);
		const playerCode = playerCodeResp.body;

		const cipherFunctionCode = getCipherFunctionCode(playerCode, jsUrl);
		console.log("DecodeCipher Function: " + cipherFunctionCode);
		_cipherDecode[jsUrl] = eval(cipherFunctionCode);

		const decryptFunctionCode = getNDecryptorFunctionCode(playerCode, jsUrl);
		console.log("DecryptN Function: " + decryptFunctionCode);
		_nDecrypt[jsUrl] = eval(decryptFunctionCode);

		const stsMatch = playerCode.match(STS_REGEX);
		console.log("stsMatch: " + stsMatch);
		if (stsMatch !== null && stsMatch.length > 1) {
			const sts = stsMatch[1];
			_sts[jsUrl] = sts;
			console.log("sts: " + sts);
		}

		return true;//_cipherDecode[jsUrl];
	}
	//catch(ex) {
	//	clearCipher(jsUrl);
	//	throw new ScriptException("Failed to get Cipher due to: " + ex);
	//}
}

function getCipherFunctionCode(playerCode, jsUrl) {
	if(_cipherDecode[jsUrl])
		return _cipherDecode[jsUrl];
	let cipherFunctionName = null;

	for(let i = 0; i < REGEX_CIPHERS.length; i++) {
		const match = playerCode.match(REGEX_CIPHERS[i]);
		if(match) {
			cipherFunctionName = match[1];
			break;
		}
	}
	if(!cipherFunctionName)	
		throw new ScriptException("Failed to find cipher (name)");
	const cipherFunctionCodeMatch = playerCode.match("(" + cipherFunctionName.replace("$", "\\$") + "=function\\([a-zA-Z0-9_]+\\)\\{.+?\\})");
	if(!cipherFunctionCodeMatch) {
		if(IS_TESTING)
			console.log("Failed to find cipher function in: ", playerCode);
		throw new ScriptException("Failed to find cipher (function)");
	}
	const cipherFunctionCode = cipherFunctionCodeMatch[1];
	const cipherFunctionCodeVar = "var " + cipherFunctionCode;
	const helperObjNameMatch = cipherFunctionCode.match(";([A-Za-z0-9_\\$]{2,3})\\...\\(");
	if(!helperObjNameMatch) {
		if(IS_TESTING)
			console.log("Failed to find helper name in: ", playerCode);
		throw new ScriptException("Failed to find helper (name)");
	}
	if(IS_TESTING)
		console.log("Cipher Code: ", cipherFunctionCode);
	const helperObjName = helperObjNameMatch[1];
	const helperObjMatch = playerCode.match("(var " + escapeRegex(helperObjName) + "=\\{[\\s\\S]*?\\};)");
	if(!helperObjMatch) {
		if(IS_TESTING)
			console.log("Failed to find helper method [" + helperObjName + "] in: ", playerCode);
		throw new ScriptException("Failed to extract helper (methods)");
	}
	const helperObj = helperObjMatch[1];
	const functionCode = "return function decodeCipher(str){ return " + cipherFunctionName + "(str); }";

	return "(function(){" + helperObj + "\n" + 
		cipherFunctionCodeVar + "\n" +
		functionCode + "})()";
}

source.searchSuggestions = function(query) {
    /**
     * @param query: string
     * @returns: string[]
     */

    const suggestions = []; //The suggestions for a specific search query
    return suggestions;
}

source.getSearchCapabilities = function() {
    //This is an example of how to return search capabilities like available sorts, filters and which feed types are available (see source.js for more details) 
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological, "^release_time"],
		filters: [
			{
				id: "date",
				name: "Date",
				isMultiSelect: false,
				filters: [
					{ id: Type.Date.Today, name: "Last 24 hours", value: "today" },
					{ id: Type.Date.LastWeek, name: "Last week", value: "thisweek" },
					{ id: Type.Date.LastMonth, name: "Last month", value: "thismonth" },
					{ id: Type.Date.LastYear, name: "Last year", value: "thisyear" }
				]
			},
		]
	};
}

source.search = function (query, type, order, filters, continuationToken) {
    /**
     * @param query: string
     * @param type: string
     * @param order: string
     * @param filters: Map<string, Array<string>>
     * @param continuationToken: any?
     * @returns: VideoPager
     */
    const videos = []; // The results (PlatformVideo)
    const hasMore = false; // Are there more pages?
    const context = { query: query, type: type, order: order, filters: filters, continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeSearchVideoPager(videos, hasMore, context);
}

source.getSearchChannelContentsCapabilities = function () {
    //This is an example of how to return search capabilities on a channel like available sorts, filters and which feed types are available (see source.js for more details)
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological],
		filters: []
	};
}

source.searchChannelContents = function (url, query, type, order, filters, continuationToken) {
    /**
     * @param url: string
     * @param query: string
     * @param type: string
     * @param order: string
     * @param filters: Map<string, Array<string>>
     * @param continuationToken: any?
     * @returns: VideoPager
     */

    const videos = []; // The results (PlatformVideo)
    const hasMore = false; // Are there more pages?
    const context = { channelUrl: channelUrl, query: query, type: type, order: order, filters: filters, continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeSearchChannelVideoPager(videos, hasMore, context);
}

source.searchChannels = function (query, continuationToken) {
    /**
     * @param query: string
     * @param continuationToken: any?
     * @returns: ChannelPager
     */

    const channels = []; // The results (PlatformChannel)
    const hasMore = false; // Are there more pages?
    const context = { query: query, continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeChannelPager(channels, hasMore, context);
}

source.isChannelUrl = function(url) {
    /**
     * @param url: string
     * @returns: boolean
     */

	return REGEX_CHANNEL_URL.test(url);
}

source.getChannel = function(url) {
	return new PlatformChannel({
		//... see source.js for more details
	});
}

source.getChannelContents = function(url, type, order, filters, continuationToken) {
    /**
     * @param url: string
     * @param type: string
     * @param order: string
     * @param filters: Map<string, Array<string>>
     * @param continuationToken: any?
     * @returns: VideoPager
     */

    const videos = []; // The results (PlatformVideo)
    const hasMore = false; // Are there more pages?
    const context = { url: url, query: query, type: type, order: order, filters: filters, continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeChannelVideoPager(videos, hasMore, context);
}

source.isContentDetailsUrl = function(url) {
    /**
     * @param url: string
     * @returns: boolean
     */

	return REGEX_DETAILS_URL.test(url);
}

// source.getContentDetails = function(url) {
//     /**
//      * @param url: string
//      * @returns: PlatformVideoDetails
//      */

// 	return new PlatformVideoDetails({
// 		//... see source.js for more details
// 	});
// }

source.getComments = function (url, continuationToken) {
    /**
     * @param url: string
     * @param continuationToken: any?
     * @returns: CommentPager
     */

    const comments = []; // The results (Comment)
    const hasMore = false; // Are there more pages?
    const context = { url: url, continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeCommentPager(comments, hasMore, context);

}
source.getSubComments = function (comment) {
    /**
     * @param comment: Comment
     * @returns: SomeCommentPager
     */

	if (typeof comment === 'string') {
		comment = JSON.parse(comment);
	}

	return getCommentsPager(comment.context.claimId, comment.context.claimId, 1, false, comment.context.commentId);
}

class SomeCommentPager extends CommentPager {
    constructor(results, hasMore, context) {
        super(results, hasMore, context);
    }

    nextPage() {
        return source.getComments(this.context.url, this.context.continuationToken);
    }
}

class HomePager extends CommentPager {
	constructor(query, initialResults) {
        this.results = initialResults;
		super();
	}
	
	nextPage() {
		return source.getHome(this.context.continuationToken);
	}
}

class SomeSearchVideoPager extends VideoPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}
	
	nextPage() {
		return source.search(this.context.query, this.context.type, this.context.order, this.context.filters, this.context.continuationToken);
	}
}

class SomeSearchChannelVideoPager extends VideoPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}
	
	nextPage() {
		return source.searchChannelContents(this.context.channelUrl, this.context.query, this.context.type, this.context.order, this.context.filters, this.context.continuationToken);
	}
}

class SomeChannelPager extends ChannelPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}
	
	nextPage() {
		return source.searchChannelContents(this.context.query, this.context.continuationToken);
	}
}

class SomeChannelVideoPager extends VideoPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}
	
	nextPage() {
		return source.getChannelContents(this.context.url, this.context.type, this.context.order, this.context.filters, this.context.continuationToken);
	}
}

const RANDOM_CHARACTER_SET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomString(length) {
	let str = "";
	for(let i = 0; i < length; i++)
		str += RANDOM_CHARACTER_SET[Math.floor(Math.random() * RANDOM_CHARACTER_SET.length)]
	return str;
}
