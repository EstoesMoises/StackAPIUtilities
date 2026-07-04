export const tagMetricsCsv = `Tag Name,Total Page Views,Webhooks,Tag Watchers,Communities,Total Smes,Median Time To First Answer Hours,Median Time To First Response Hours,Total Unique Contributors,Unique Askers,Unique Answerers,Unique Commenters,Unique Article Contributors,Question Count,Question Upvotes,Question Downvotes,Question Comments,Questions No Answers,Questions Accepted Answer,Questions Self Answered,Answer Count,Sme Answers,Answer Upvotes,Answer Downvotes,Answer Comments,Article Count,Article Upvotes,Article Comments
machine-learning,551412,22,275,3,15,7.41,4.08,1781,970,763,1014,2,1355,3800,138,1899,222,519,56,1916,2,4426,99,1947,3,6,0
python,338584,44,188,5,25,6.43,4.07,894,411,434,503,3,616,1323,75,658,122,260,67,795,10,1747,36,740,3,6,1`;

export const userMetricsCsv = `User ID,Display Name,Net Reputation,Account Longevity (Days),Account Inactivity (Days),Questions,Questions With No Answers,Answers,Answers Accepted,Median Answer Time (Hours),Articles,Comments,Total Upvotes,Total Downvotes,SME Tags,Account Status,Moderator,Email,Title,Department,External ID,Account ID
96,Harley Q.,20207,2248,0,262,6,554,455,1.15,35,284,1498,2,"release-management, product-support",Registered,FALSE,user@company.com,"Director, Product Support",Product Operations and Experience,,1`;

export const inactiveUsersCsv = `user_id,verified_email,display_name,inactive_days,is_deactivated,reputation,answer_count,question_count,article_count,comment_count,down_vote_count,up_vote_count
11,user1@company.com,Shreyas,297,TRUE,11,0,1,0,0,0,0
5,user23@company.com,Jabed,243,TRUE,1,0,0,0,0,0,2`;

export const communityMembersCsv = `Name,Email,Member Since,Is SME,Job Title,Department
Jane Doe,jane.doe@company.com,2024-03-15T10:30:00,True,Software Engineer,Engineering
John Smith,john.smith@company.com,2024-06-22T14:15:00,False,Product Manager,Product`;

export const interactionMatrixCsv = `source,Engineering,Product
Engineering,0,4
Product,2,0`;

export const dataExportUsersJson = JSON.stringify([
  { user_id: 96, display_name: "Harley Q.", answer_count: 554 },
  { user_id: 365, display_name: "Tony S.", answer_count: 265 },
]);
